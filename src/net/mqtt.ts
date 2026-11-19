// A tiny MQTT 3.1.1 client over a secure WebSocket: connect (with a "last will"), subscribe,
// publish (QoS 0, optionally retained), keep-alive pings (keep-alive 300 s: background tabs only run timers about once a minute). Enough to relay small game messages
// through a public broker; no library needed.

const enc = new TextEncoder(), dec = new TextDecoder();

function str(s: string) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}
function packet(type: number, body: number[]): Uint8Array<ArrayBuffer> {
  const len: number[] = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    len.push(d);
  } while (n > 0);
  return new Uint8Array([type, ...len, ...body]);
}

export interface Will { topic: string; payload: string; retain: boolean }

export class Mqtt {
  onMessage: (topic: string, payload: string) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket;
  private buf = new Uint8Array(0);
  private skip = 0; // bytes of an oversized packet still to drop
  private ping = 0;
  private nextId = 1;
  private acks = new Map<number, () => void>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
  }

  /** Connects to the first broker that answers. */
  static async connect(urls: string[], clientId: string, will?: Will): Promise<Mqtt> {
    let last: unknown = null;
    for (const url of urls) {
      try {
        return await Mqtt.connectOne(url, clientId, will);
      } catch (e) {
        last = e;
      }
    }
    throw last ?? new Error('no broker');
  }

  private static connectOne(url: string, clientId: string, will?: Will) {
    return new Promise<Mqtt>((resolve, reject) => {
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const m = new Mqtt(ws);
      const fail = window.setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 6000);
      ws.onerror = () => {
        clearTimeout(fail);
        reject(new Error('ws error'));
      };
      ws.onopen = () => {
        let flags = 0x02; // clean session
        const payload = [...str(clientId)];
        if (will) {
          flags |= 0x04 | (will.retain ? 0x20 : 0);
          payload.push(...str(will.topic), ...str(will.payload));
        }
        ws.send(packet(0x10, [...str("MQTT"), 4, flags, 300 >> 8, 300 & 255, ...payload]));
      };
      let connected = false;
      ws.onmessage = (e) => {
        m.receive(new Uint8Array(e.data as ArrayBuffer), (type, body) => {
          if (!connected && type === 0x20) {
            clearTimeout(fail);
            if (body[1] !== 0) {
              ws.close();
              reject(new Error(`refused ${body[1]}`));
              return;
            }
            connected = true;
            m.ping = window.setInterval(() => m.send(new Uint8Array([0xc0, 0])), 20000);
            resolve(m);
          }
        });
      };
      ws.onclose = () => {
        clearTimeout(fail);
        if (!connected) reject(new Error('closed'));
        else m.shutdown();
      };
    });
  }

  /** Splits the byte stream into packets. */
  private receive(data: Uint8Array, first?: (type: number, body: Uint8Array) => void) {
    // Still dropping the rest of an oversized packet?
    if (this.skip > 0) {
      const n = Math.min(this.skip, data.length);
      this.skip -= n;
      data = data.subarray(n);
      if (!data.length) return;
    }
    const all = new Uint8Array(this.buf.length + data.length);
    all.set(this.buf);
    all.set(data, this.buf.length);
    let i = 0;
    while (i + 2 <= all.length) {
      let len = 0, mul = 1, j = i + 1;
      for (;;) {
        if (j >= all.length) {
          j = -1;
          break;
        }
        const d = all[j++];
        len += (d & 127) * mul;
        mul *= 128;
        if (!(d & 128)) break;
      }
      if (j < 0) break;
      if (len > 8192) {
        // Nothing in this game is that big: skip it without keeping it in memory.
        const end = j + len;
        if (end <= all.length) {
          i = end;
          continue;
        }
        this.skip = end - all.length;
        this.buf = new Uint8Array(0);
        return;
      }
      if (j + len > all.length) break;
      const type = all[i], body = all.subarray(j, j + len);
      if (first) first(type, body);
      this.handle(type, body);
      i = j + len;
    }
    this.buf = all.slice(i);
  }

  private handle(type: number, body: Uint8Array) {
    const kind = type & 0xf0;
    if (kind === 0x30) {
      if (body.length > 4096) return; // game messages are small; ignore anything big
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const qos = (type >> 1) & 3;
      const start = 2 + tl + (qos ? 2 : 0);
      this.onMessage(topic, dec.decode(body.subarray(start)));
    } else if (kind === 0x90) {
      const id = (body[0] << 8) | body[1];
      this.acks.get(id)?.();
      this.acks.delete(id);
    }
  }

  private send(b: Uint8Array<ArrayBuffer>) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(b);
  }

  subscribe(topic: string) {
    const id = this.nextId++;
    return new Promise<void>((resolve) => {
      this.acks.set(id, resolve);
      this.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
    });
  }

  publish(topic: string, payload: string, retain = false) {
    this.send(packet(0x30 | (retain ? 1 : 0), [...str(topic), ...enc.encode(payload)]));
  }

  /** How much is still waiting to go out (to skip pose updates on a slow line). */
  get backlog() {
    return this.ws.bufferedAmount;
  }

  close() {
    if (this.closed) return;
    this.send(new Uint8Array([0xe0, 0]));
    this.ws.close();
    this.shutdown();
  }

  private shutdown() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    this.onClose();
  }
}
