// Playing together: one player starts a room and gets a short code, the others join with it.
// Messages go through a public MQTT broker over a secure WebSocket (works where direct
// browser-to-browser connections are blocked, and players never see each other's address).
//
// What is sent: a made-up nickname, the car and paint, the car's position, and stunt messages.
// Nothing else (no real names, no progress, no math answers). Anyone who knows a room code can
// see that room's cars, so the code is the only "key", just like a game lobby.
//
// Topics, under utrecht-drive/v1/<CODE>/:
//   room          retained: the room is open (cleared when the host leaves, also on a lost connection)
//   info/<id>     retained: a player's name and car (cleared when they leave)
//   p/<id>        car pose, 10 times a second
//   s/<id>        stunt message
import { Mqtt } from './mqtt';

export interface PlayerInfo { id: string; name: string; car: string; paint: number }
/** Car pose: x, y, z, quaternion x, y, z, w, speed (m/s), steering (rad). */
export type Pose = number[];

export const MAX_PLAYERS = 8;
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const BASE = 'utrecht-drive/v1/';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const SEND_HZ = 10;

export const makeCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const makeId = () => Array.from({ length: 10 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('').toLowerCase();

export interface RoomEvents {
  join: (p: PlayerInfo) => void;
  info: (p: PlayerInfo) => void;
  leave: (id: string) => void;
  pose: (id: string, pose: Pose) => void;
  stunt: (id: string, text: string) => void;
  /** The room is gone (host left, connection lost). */
  closed: (reason: 'host-left' | 'error') => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Room {
  readonly code: string;
  readonly host: boolean;
  readonly myId = makeId();
  players = new Map<string, PlayerInfo>(); // the others
  private mq!: Mqtt;
  private timer = 0;
  private myPose: Pose | null = null;
  private closed = false;
  private roomSeen = false;
  private ready = false;

  private constructor(code: string, host: boolean, private myInfo: Omit<PlayerInfo, 'id'>, private on: RoomEvents) {
    this.code = code;
    this.host = host;
  }

  private get base() {
    return BASE + this.code + '/';
  }

  private async open() {
    // If the connection drops, the broker clears what we left behind.
    const will = this.host ? { topic: this.base + 'room', payload: '', retain: true } : { topic: this.base + 'info/' + this.myId, payload: '', retain: true };
    this.mq = await Mqtt.connect(BROKERS, 'ud-' + this.myId, will);
    this.mq.onMessage = (topic, payload) => this.message(topic, payload);
    this.mq.onClose = () => {
      if (this.closed) return;
      this.stop();
      this.on.closed('error');
    };
    await this.mq.subscribe(this.base + '#');
  }

  /** Starts a room with a code nobody is using. */
  static async create(info: Omit<PlayerInfo, 'id'>, on: RoomEvents): Promise<Room> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = new Room(makeCode(), true, info, on);
      await room.open();
      await sleep(800); // a retained "room" message would show up by now
      if (room.roomSeen) {
        room.mq.close();
        continue;
      }
      room.mq.publish(room.base + 'room', JSON.stringify({ host: room.myId }), true);
      room.start();
      return room;
    }
    throw new Error('no free room code');
  }

  /** Joins a room by code. Fails with 'no-room' or 'full'. */
  static async join(code: string, info: Omit<PlayerInfo, 'id'>, on: RoomEvents): Promise<Room> {
    const room = new Room(code, false, info, on);
    await room.open();
    for (let i = 0; i < 25 && !room.roomSeen; i++) await sleep(100);
    await sleep(500); // let the retained player list arrive
    if (!room.roomSeen || room.players.size >= MAX_PLAYERS) {
      room.closed = true;
      room.mq.close();
      throw new Error(room.roomSeen ? 'full' : 'no-room');
    }
    room.start();
    return room;
  }

  private start() {
    this.ready = true;
    this.mq.publish(this.base + 'info/' + this.myId, JSON.stringify(this.myInfo), true);
    for (const p of this.players.values()) this.on.join(p);
    this.timer = window.setInterval(() => this.tick(), 1000 / SEND_HZ);
  }

  private message(topic: string, payload: string) {
    if (!topic.startsWith(this.base)) return;
    const [kind, id] = topic.slice(this.base.length).split('/');
    if (kind === 'room') {
      if (payload) this.roomSeen = true;
      else if (this.roomSeen && !this.host && !this.closed) {
        this.stop();
        this.mq.close();
        this.on.closed('host-left');
      }
      return;
    }
    if (!id || id === this.myId) return;
    let data: unknown;
    try {
      data = payload ? JSON.parse(payload) : null;
    } catch {
      return;
    }
    if (kind === 'info') {
      if (!data) {
        if (this.players.delete(id) && this.ready) this.on.leave(id);
        return;
      }
      const info = { ...sanitize(data as PlayerInfo), id };
      const known = this.players.has(id);
      this.players.set(id, info);
      if (this.ready) (known ? this.on.info : this.on.join)(info);
    } else if (!this.ready) return;
    else if (kind === 'p') {
      if (this.players.has(id) && validPose(data)) this.on.pose(id, data);
    } else if (kind === 's') {
      if (this.players.has(id) && typeof data === 'string') this.on.stunt(id, data.slice(0, 80));
    }
  }

  private tick() {
    if (this.closed || !this.myPose) return;
    if (this.mq.backlog > 4096) return; // slow line: skip this one
    this.mq.publish(this.base + 'p/' + this.myId, JSON.stringify(this.myPose));
  }

  /** My car's pose; sent 10 times a second. */
  setPose(pose: Pose) {
    this.myPose = pose.map((v) => Math.round(v * 1000) / 1000);
  }

  /** My car or paint changed. */
  setInfo(info: Omit<PlayerInfo, 'id'>) {
    this.myInfo = info;
    if (this.ready && !this.closed) this.mq.publish(this.base + 'info/' + this.myId, JSON.stringify(info), true);
  }

  /** Tell the others about a stunt (shown as a small message). */
  sendStunt(text: string) {
    if (this.ready && !this.closed) this.mq.publish(this.base + 's/' + this.myId, JSON.stringify(text));
  }

  private stop() {
    this.closed = true;
    clearInterval(this.timer);
  }

  leave() {
    if (this.closed) return;
    this.stop();
    // A clean goodbye: clear my retained messages (the "last will" only fires on a lost connection).
    this.mq.publish(this.base + 'info/' + this.myId, '', true);
    if (this.host) this.mq.publish(this.base + 'room', '', true);
    this.mq.close();
  }
}

function sanitize(i: Partial<PlayerInfo>): Omit<PlayerInfo, 'id'> {
  return { name: String(i?.name ?? '?').slice(0, 24), car: String(i?.car ?? '').slice(0, 32), paint: Number(i?.paint) || 0 };
}
const validPose = (p: unknown): p is Pose => Array.isArray(p) && p.length === 9 && p.every((v) => typeof v === 'number' && Number.isFinite(v));
