import { createWorker } from 'mediasoup';
import { v4 as uuidv4 } from 'uuid';

export class Room {
  constructor(roomId) {
    this.roomId = roomId;
    this.users = []; // [{ socket, transport, consumers, producers }]
    this.transports = [];
    this.producers = [];
    this.worker = null;
    this.router = null;
    this.message = []
  }

  async initializeRouter() {
    this.worker = await createWorker({
      rtcMinPort: 10000,
      rtcMaxPort: 20000,
    });

    


    this.router = await this.worker.createRouter({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:82.202.130.213:3478?transport=udp', username: 'user', credential: 'pass' }, 
      ],
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {}
        }
      ],
    });

  }

  addUser(ws) {
    const userExists = this.users.some(u => u.socket === ws);
    if (!userExists) {
      this.users.push({
        socket: ws,
        transport: null,
        producers: [],
        consumers: [],
        listenProducers: [],
        name: ''
      });
    }
  }

  removeUser(ws) {
    this.users = this.users.filter(user => user.socket !== ws);
    this.transports = this.transports.filter(t => t.appData.socket !== ws);
    this.producers = this.producers.filter(p => p.socket !== ws);
  }

  getUser(ws) {
    return this.users.find(user => user.socket === ws);
  }

  getTransport(ws) {
    const user = this.getUser(ws);
    return user?.transport || null;
  }

  addListenProducersForConsumer(ws, producerId) {
    this.users.map(user => user.socket == ws ? {...user, listenProducers: [...user.listenProducers, producerId]} : user)
  }

  getTransportBySocket(ws) {
    return this.transports.find(t => t.appData?.socket === ws);
  }

  async createTransport(ws) {
    const transport = await this.router.createWebRtcTransport({
      listenIps: [{ ip: '127.0.0.1', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      appData: { socket: ws },
    });

    this.transports.push(transport);

    const user = this.getUser(ws);
    
    if (user) {
      user.transport = transport;
    }
    return transport;
  }

  async createProducer(ws, rtpParameters, kind) {
    const transport = this.getTransport(ws);
    if (!transport) throw new Error('Transport not found for user');

    const producer = await transport.produce({ kind, rtpParameters });

    this.producers.push({ socket: ws, producer });

    const user = this.getUser(ws);
    if (user) {
      user.producers.push(producer);
    }

    return producer;
  }

  saveProducer(ws, producer) {
    this.producers.push({ socket: ws, producer });

    const user = this.getUser(ws);
    if (user) {
      user.producers.push(producer);
    }
  }

  addConsumer(ws, consumer) {
    const user = this.getUser(ws);
    if (user) {
      user.consumers.push(consumer);
    }
  }

  getAllTransports() {
    return this.transports
  }

  findProducerById(producerId) {
    const found = this.producers.find(p => p.producer.id === producerId);
    return found ? found.producer : null;
  }

  sendMessage(name, message) {
    const currDate = (new Date).getTime()
    const data = {timeunix: currDate, message, id: currDate, name}
    this.message.push({timeunix: currDate, message, id: currDate, name})
    return data
  }

  setName(ws, name) {
    const user = this.getUser(ws);
    user.name = name
  }

  broadcast(message, ws) {
    for (const user of this.users.filter(u => u.socket !== ws)) {
      try {
        user.socket.send(JSON.stringify(message));
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }
  }
  broadcastAll(message) {
    for (const user of this.users) {
      try {
        user.socket.send(JSON.stringify(message));
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }
  }
}
