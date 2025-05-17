import { createWorker } from 'mediasoup';
import { handleTimeoutRemoveRoom } from './actions.js';

const SECONDS = 15;
const TIMEOUT_MAX = (SECONDS / 60) * 60 * 1000;

export class Room {
  constructor(roomId) {
    this.roomId = roomId;
    this.users = []; // [{ socket, transport, consumers, producers }]
    this.transports = [];
    this.producers = [];
    this.worker = null;
    this.router = null;
    this.message = []
    this.producerUserId = null
    this.active = 'live'
    this.producerLeaveUnix = 0;
    this.producerTimeout = null;
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
        name: '',
        type: null,
        userId: null
      });
    }
  }

  setProducerId(id) {
    this.producerUserId = id;
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
    const user = this.getUser(ws);   
    if (user) {
      user.listenProducers.push(producerId);
    }
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

  clearProducers() {
    this.producers = [];
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

  setInfo(ws, type, userId) {
    const user = this.getUser(ws);
    if (user) {
      user.type = type;
      user.userId = userId;
    }
  }

  setActiveRoom(type) {
    this.active = type;
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

  setProducerLeaveTime() {
    this.producerLeaveUnix = (new Date()).getTime();
  }

  removeUser(ws) {
    const user = this.getUser(ws);
    if (!user) return;

    for (const producer of user.producers) {
      try {
        producer.close();
      } catch (e) {
        console.warn('Error closing producer:', e);
      }
    }
  
    for (const consumer of user.consumers) {
      try {
        consumer.close();
      } catch (e) {
        console.warn('Error closing consumer:', e);
      }
    }
  
  
    if (user.transport) {
      try {
        user.transport.close();
      } catch (e) {
        console.warn('Error closing transport:', e);
      }
    }
  
    this.transports = this.transports.filter(t => t.appData.socket !== ws);
  
    this.producers = this.producers.filter(p => p.socket !== ws);
  
    this.users = this.users.filter(user => user.socket !== ws);
  }

  
  startProducerTimeout() {
    const START_TIME = (new Date()).getTime();
    if (this.producerTimeout) clearTimeout(this.producerTimeout);
  
    this.producerTimeout = setTimeout(() => {
      
      console.log('TIMER - ', (new Date()).getTime() - START_TIME)
      if (this.active == 'sleep') {
        handleTimeoutRemoveRoom(this.roomId);
      }
    }, TIMEOUT_MAX);
  }

  clearProducerTimeout() {
    if (this.producerTimeout) {
      clearTimeout(this.producerTimeout);
      this.producerTimeout = null;
    }
  }

  destroy() {
    // Закрыть всех пользователей
    for (const user of this.users) {
      // Закрыть consumer'ов
      for (const consumer of user.consumers) {
        try {
          consumer.close(); // Уничтожает Consumer внутри mediasoup
        } catch (e) {
          console.warn('Ошибка при закрытии consumer:', e);
        }
      }
  
      // Закрыть producer'ов
      for (const producer of user.producers) {
        try {
          producer.close(); // Уничтожает Producer внутри mediasoup
        } catch (e) {
          console.warn('Ошибка при закрытии producer:', e);
        }
      }
  
      // Закрыть транспорт
      if (user.transport) {
        try {
          user.transport.close(); // Уничтожает Transport внутри mediasoup
        } catch (e) {
          console.warn('Ошибка при закрытии транспорта:', e);
        }
      }
    }
  
    // Очистить router
    if (this.router) {
      try {
        this.router.close(); // Освобождает Router
      } catch (e) {
        console.warn('Ошибка при закрытии router:', e);
      }
    }
  
    // Закрыть worker (если он только под эту комнату)
    if (this.worker) {
      try {
        this.worker.close(); // Закрывает Worker
      } catch (e) {
        console.warn('Ошибка при закрытии worker:', e);
      }
    }
  
    // Очищаем внутренние структуры
    this.users = [];
    this.transports = [];
    this.producers = [];
    this.router = null;
    this.worker = null;
    this.producerUserId = null;
    this.producerLeaveUnix = 0;
  
    // Очищаем таймер, если был
    this.clearProducerTimeout();
  }
  
}


