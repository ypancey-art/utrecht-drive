// Playing together: one player starts a room and gets a 6-character code, the others join with it.
// Messages go through a public MQTT broker over a secure WebSocket.
//
// The broker is public, so the room code is used as a secret key: the topic name is a hash of
// the code and every message is encrypted with a key made from it (PBKDF2 → AES-GCM). Without
// the code, nobody can find a room, read it, or send anything into it.
//
// What is sent: two word numbers for the made-up nickname, the car and paint, the car's
// position, and stunt points. No free text at all (so it can't be used to chat with children),
// no real names, no progress, no math answers.
//
// Topics, under utrecht-drive/v2/<hash of code>/:
//   room          retained: the room is open (cleared when the host leaves, also on a lost connection)
//   info/<id>     retained: a player's nickname and car (cleared when they leave)
//   p/<id>        car pose, 10 times a second
//   s/<id>        stunt points
import { Mqtt } from './mqtt';
import { validNick, nickName, type Nick } from '../game/nicknames';
import { CARS } from '../game/cars';

export interface PlayerInfo { id: string; nick: Nick; name: string; car: string; paint: number }
export type MyInfo = Omit<PlayerInfo, 'id' | 'name'>;
/** Car pose: x, y, z, quaternion x, y, z, w, speed (m/s), steering (rad). */
export type Pose = number[];

export const MAX_PLAYERS = 8;
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const BASE = 'utrecht-drive/v2/';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const CODE_LEN = 6;
const SEND_HZ = 10;
const MAX_POSES_PER_S = 20; // per player; more is dropped
const MAP_LIMIT = 1500; // m from the centre: poses outside are nonsense

const randomString = (n: number) => {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (v) => LETTERS[v % LETTERS.length]).join('');
};
export const makeCode = () => randomString(CODE_LEN);
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
const ID_RE = /^[a-z2-9]{10}$/;

export interface RoomEvents {
  join: (p: PlayerInfo) => void;
  info: (p: PlayerInfo) => void;
  leave: (id: string) => void;
  pose: (id: string, pose: Pose) => void;
  stunt: (id: string, points: number) => void;
  /** The room is gone (host left, connection lost). */
  closed: (reason: 'host-left' | 'error') => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Topic name and encryption key from the room code. */
async function keysFor(code: string) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('utrecht-drive-room-v2'), iterations: 100_000 }, base, 384));
  const topic = Array.from(bits.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits.subarray(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class Room {
  readonly code: string;
  readonly host: boolean;
  readonly myId = randomString(10).toLowerCase();
  players = new Map<string, PlayerInfo>(); // the others
  private mq!: Mqtt;
  private key!: CryptoKey;
  private base = '';
  private timer = 0;
  private myPose: Pose | null = null;
  private closed = false;
  private roomSeen = false;
  private ready = false;
  private poseTimes = new Map<string, number[]>();

  private constructor(code: string, host: boolean, private myInfo: MyInfo, private on: RoomEvents) {
    this.code = code;
    this.host = host;
  }

  private async open() {
    const { topic, key } = await keysFor(this.code);
    this.key = key;
    this.base = BASE + topic + '/';
    // If the connection drops, the broker clears what we left behind (an empty retained message).
    const will = { topic: this.base + (this.host ? 'room' : 'info/' + this.myId), payload: '', retain: true };
    this.mq = await Mqtt.connect(BROKERS, 'ud-' + this.myId, will);
    this.mq.onMessage = (t, payload) => void this.message(t, payload);
    this.mq.onClose = () => {
      if (this.closed) return;
      this.stop();
      this.on.closed('error');
    };
    await this.mq.subscribe(this.base + '#');
  }

  private async seal(data: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(data))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return toB64(out);
  }

  private async open_(payload: string): Promise<unknown> {
    try {
      const b = fromB64(payload);
      if (b.length < 29) return undefined;
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, this.key, b.subarray(12));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch {
      return undefined; // not from someone with the code: ignore
    }
  }

  private async send(topic: string, data: unknown, retain = false) {
    const payload = await this.seal(data);
    if (!this.closed) this.mq.publish(this.base + topic, payload, retain);
  }

  /** Starts a room with a code nobody is using. */
  static async create(info: MyInfo, on: RoomEvents): Promise<Room> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = new Room(makeCode(), true, info, on);
      await room.open();
      await sleep(800); // a retained "room" message would show up by now
      if (room.roomSeen) {
        room.closed = true;
        room.mq.close();
        continue;
      }
      await room.send('room', { host: room.myId }, true);
      room.start();
      return room;
    }
    throw new Error('no free room code');
  }

  /** Joins a room by code. Fails with 'no-room' or 'full'. */
  static async join(code: string, info: MyInfo, on: RoomEvents): Promise<Room> {
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
    void this.send('info/' + this.myId, this.myInfo, true);
    for (const p of this.players.values()) this.on.join(p);
    this.timer = window.setInterval(() => this.tick(), 1000 / SEND_HZ);
  }

  private async message(topic: string, payload: string) {
    if (!topic.startsWith(this.base) || payload.length > 2048) return;
    const [kind, id, extra] = topic.slice(this.base.length).split('/');
    if (extra !== undefined) return;
    if (kind === 'room') {
      if (!payload) {
        // The host left (or lost the connection).
        if (this.roomSeen && !this.host && !this.closed) {
          this.stop();
          this.mq.close();
          this.on.closed('host-left');
        }
        return;
      }
      const d = (await this.open_(payload)) as { host?: unknown } | undefined;
      if (d && typeof d.host === 'string') this.roomSeen = true;
      return;
    }
    if (!id || id === this.myId || !ID_RE.test(id)) return;
    if (kind === 'info' && !payload) {
      this.poseTimes.delete(id);
      if (this.players.delete(id) && this.ready) this.on.leave(id);
      return;
    }
    if (kind === 'p' && (!this.players.has(id) || !this.poseAllowed(id))) return;
    const data = await this.open_(payload);
    if (data === undefined || this.closed) return;
    if (kind === 'info') {
      const d = data as Partial<MyInfo>;
      if (!validNick(d.nick)) return;
      const known = this.players.get(id);
      if (!known && this.players.size >= MAX_PLAYERS - 1) return; // room is full: ignore extra players
      const car = CARS.some((c) => c.id === d.car) ? String(d.car) : CARS[0].id;
      const paint = Number.isInteger(d.paint) && d.paint! >= 0 && d.paint! <= 0xffffff ? d.paint! : 0;
      const info: PlayerInfo = { id, nick: d.nick, name: nickName(d.nick), car, paint };
      if (known && known.car === info.car && known.paint === info.paint && known.nick.join() === info.nick.join()) return;
      this.players.set(id, info);
      if (this.ready) (known ? this.on.info : this.on.join)(info);
    } else if (!this.ready) return;
    else if (kind === 'p') {
      if (this.players.has(id) && validPose(data)) this.on.pose(id, data);
    } else if (kind === 's') {
      const p = (data as { p?: unknown })?.p;
      if (this.players.has(id) && Number.isInteger(p) && (p as number) > 0 && (p as number) < 1000) this.on.stunt(id, p as number);
    }
  }

  /** At most MAX_POSES_PER_S poses per player per second. */
  private poseAllowed(id: string) {
    const now = performance.now();
    const list = (this.poseTimes.get(id) ?? []).filter((t) => now - t < 1000);
    if (list.length >= MAX_POSES_PER_S) return false;
    list.push(now);
    this.poseTimes.set(id, list);
    return true;
  }

  private tick() {
    if (this.closed || !this.myPose) return;
    if (this.mq.backlog > 4096) return; // slow line: skip this one
    void this.send('p/' + this.myId, this.myPose);
  }

  /** My car's pose; sent 10 times a second. */
  setPose(pose: Pose) {
    this.myPose = pose.map((v) => Math.round(v * 1000) / 1000);
  }

  /** My car or paint changed. */
  setInfo(info: MyInfo) {
    this.myInfo = info;
    if (this.ready && !this.closed) void this.send('info/' + this.myId, info, true);
  }

  /** Tell the others about a stunt (they see "<nickname>: stunt! +<points>"). */
  sendStunt(points: number) {
    if (this.ready && !this.closed) void this.send('s/' + this.myId, { p: Math.max(1, Math.min(999, Math.round(points))) });
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

const validPose = (p: unknown): p is Pose => {
  if (!Array.isArray(p) || p.length !== 9 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const q = Math.hypot(p[3], p[4], p[5], p[6]);
  return Math.abs(p[0]) < MAP_LIMIT && Math.abs(p[2]) < MAP_LIMIT && p[1] > -30 && p[1] < 300 && q > 0.9 && q < 1.1 && Math.abs(p[7]) < 120 && Math.abs(p[8]) < 1;
};
