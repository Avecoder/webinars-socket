import { v4 as uuidv4 } from 'uuid';
import {Room} from './room.js'

const rooms = {

}


const usedSSRCs = new Set();

function generateUniqueSSRC() {
    let ssrc;
    do {
      ssrc = Math.floor(Math.random() * 0xffffffff); // 32-bit unsigned int
    } while (usedSSRCs.has(ssrc));
    
    usedSSRCs.add(ssrc);
    return ssrc;
  }

const send = (route, ws, response) => {
   try {
        const type = route.split('/')[1]
        const data = JSON.stringify({type, ...response})
        ws.send(data)
   } catch(err) {
        console.error('send error - ', err)
   }
}

const generateUserResponse = async (ws, room, userId) => {
    try {
        room.addUser(ws);

        room.setName(ws, 'PRODUCER')
        room.setInfo(ws, 'producer', userId);

        ws.currentRoom = room.roomId;

        room.setProducerId(userId);

        const transport = await room.createTransport(ws);
        const transportOptions = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        };

        return {transportOptions, routerRtpCapabilities: room.router.rtpCapabilities}
    } catch (err) {
        console.error("generateUserResponse err: ", err);
    }
}

const handleCreateRoom = async ({ ws, userId }) => {
    try {
        const roomId = uuidv4();
        

        if (!rooms[roomId]) {
            const room = new Room(roomId);
            await room.initializeRouter();
        
            rooms[roomId] = room;

            const res = await generateUserResponse(ws, room, userId);

            
            send('/roomCreated', ws, {
                roomId,
                ...res
            }) 
        } else {
            send('/error', ws, {
                message: 'Room already exists'  
            }) 
        }
    } catch(err) {
        console.error('handleCreateRoom error: ', err)
    }
  };

 const handleCreateProducer = async ({ ws, roomId, kind, rtpParameters, appointment = 'audio' }) => {
    try {

        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');

        const transport = room.getTransport(ws);
        if (!transport) throw new Error('Transport not found for user');

        const producer = await transport.produce({
            kind,
            rtpParameters,
            paused: false,
            encodings: [
              { ssrc: generateUniqueSSRC(), maxBitrate: 1000000 }
            ],
            codecOptions: {
              videoGoogleStartBitrate: 1000
            }
        });

        producer.observer.on('pause', () => {
            console.log('pause producer')
        });
          
        producer.observer.on('resume', () => {
            console.log('resume producer')
        });

        producer.appointment = appointment

      
        room.saveProducer(ws, producer);

        ws.role = 'producer'
        
        send('/producerCreated', ws, {
            producerId: producer.id,
            role: ws.role,
            roomId,
            appointment
        }) 
        send('/produceInfo', ws, {
            producerId: producer.id,
        }) 
        room.broadcast({type: 'updateConsumers'}, ws)
    } catch(err) {
        console.error('handleCreateProducer error: ', err)
    }
 }

 const handleConnectTransport = async ({ws, dtlsParameters, roomId}) => {
    try {
        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');

        const transport = room.getTransport(ws);
        if (!transport) throw new Error('Transport not found for user');

        if (transport.connected) {
            send('/transportConnected', ws, { 
                message: 'Transport already connected'
            }) 
            return;
        }

        await transport.connect({ dtlsParameters })

        send('/transportConnected', ws, { 
            message: 'Transport connected'
        }) 
    } catch(err) {
        console.error('handleConnectTransport error: ', err)
    }
 }


 const handleRemoveRoom = async ({ws, roomId}) => {
    try {
        console.log('roomID - ', roomId)
        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');
        room.broadcast({type: 'removeRoom'}, ws)
        delete rooms[roomId];
    } catch(err) {
        console.error('handleRemoveRoom error: ', err)
    }
 }

 const handleCheckRoom = async ({ws, roomId, userId}) => {
    try {
        const room = rooms[roomId];
        let recconect = false
        if(room) {
            console.log(room.producerUserId, userId, room.active)
            if(room.producerUserId == userId && room.active == 'sleep') {
                recconect = true
            }
        } else {
            send('/removedRoom', ws, {});
            return;
        }
        send('/roomStatus', ws, {isExist: !!room, recconect})

    } catch(err) {
        console.error('handleRemoveRoom error: ', err)
    }
 }

 const handleCreateConsumer = async ({ ws, roomId }) => {
    try {
        const room = rooms[roomId];
        if (!room) return send('/error', ws, { message: 'Room not found' });

        const user = room.getUser(ws);
        if (!user) return send('/error', ws, { message: 'User not found' });

        const listenProducers = user.listenProducers || [];

        console.log('listenProducer - ', listenProducers)

        const consumeProducerList = room.producers
            .map(data => data.producer.id)
            .filter(id => !listenProducers.includes(id));

        const rtpCapabilities = room.router.rtpCapabilities;
        const transport = room.getTransport(ws);

        for (const producerId of consumeProducerList) {
            const producer = room.findProducerById(producerId);
            if (!producer) {
                console.warn(`Producer ${producerId} not found`);
                continue;
            }

            const canConsume = room.router.canConsume({ producerId, rtpCapabilities });
            if (!canConsume) {
                console.warn(`Cannot consume producer ${producerId} - ${producer.appointment}`);
                continue;
            }
            room.addListenProducersForConsumer(ws, producerId)

            const consumer = await transport.consume({
                producerId,
                rtpCapabilities,
                paused: false,
            });

            consumer.observer.on("close", () => {
                send('/offTrack', ws, {producerId})
            })

            room.addConsumer(ws, consumer);

            send('/createConsumer', ws, {
                consumerParameters: {
                    id: consumer.id,
                    producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                    
                },
                appointment: producer.appointment
            });
        }
    } catch (err) {
        console.error('handleCreateConsumer error:', err);
    }
}


 const handleJoinRoom = async ({ws, roomId, producerId, rtpCapabilities, userId}) => {
    try {
        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');
        
        room.addUser(ws);

        room.setName(ws, `consumer - ${(new Date().getTime())}`)
        room.setInfo(ws, 'consumer', userId);

        ws.currentRoom = roomId;
        
        const transport = await room.createTransport(ws);
        const transportOptions = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        };

        send('/joinedRoom', ws, {
            transportOptions,
            routerRtpCapabilities: room.router.rtpCapabilities
        })
    } catch(err) {
        console.error('handleJoinRoom error: ', err)
    }
 }

 const muteMicro = ({ws, mute, roomId}) => {
    try {
        const room = rooms[roomId];
        if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        const producersId = room.producers.filter(data => data.producer.kind == 'audio').map(data => data.producer.id)
        
        for(const id of producersId) {
            const producer = room.findProducerById(id);

            if(mute) {
                producer.pause()
            } else {
                producer.resume()
            }
        }

        room.broadcast({type: 'mute', mute})
  
        // console.log('mute micro - ', mute)
    } catch {
        console.error('muteMicro error: ', err)
    }
 }

const handleRemoveProducer = ({ws, producerId, roomId}) => {
    try {
        const room = rooms[roomId];
        if (!room) return send('/error', ws, { message: 'Room not found' });
        const producer = room.findProducerById(producerId);
        console.log('CLOSE PRODUCER - ', producer.id)
        producer.close();
    } catch (err) {
        console.error('handleRemoveProducer error: ', err)
    }
}

const handleSendMessage = ({ws, roomId, message}) => {
    try {
        const room = rooms[roomId];
        if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));

        const user = room.getUser(ws)
        const msg = room.sendMessage(user.name, message)
        room.broadcastAll({type: 'updateChat', newMess: msg})
    } catch (err) {
        console.error('handleSendMessage error: ', err)
    }
}

export const handleLeaveUser = (ws) => {
    try {
        if(ws.currentRoom) {
            const room = rooms[ws.currentRoom]
            const user = room.getUser(ws)

            if(user?.type == 'producer') {
                room.setActiveRoom('sleep');
                room.broadcast({type: 'sleep'}, ws);
                room.startProducerTimeout();
            } else {
                room.removeUser(ws);
                
            }

        }
    } catch (err) {
        console.error('handleLeaveUser error: ', err)
    }
}

export const handleRestartSFU = ({roomId, ws}) => {
    try {
        const room = rooms[roomId];
        if(!room) {
            send('/removedRoom', ws, {});
            return;
        }
        room.clearProducerTimeout();
        room.setActiveRoom('active');
        room.broadcast({type: 'producerRestartSFU'}, ws);
    } catch (err) {
        console.error('handleRestartSFU error: ', err)
    }
}

export const handleRecconect = async ({ws, userId, roomId}) => {
    try {
        const room = rooms[roomId]
        if(!room) {
            send('/removedRoom', ws, {});
            return;
        }

        const res = await generateUserResponse(ws, room, userId);
        const tracksType = [...new Set(room.producers.map(p => p.producer.appointment).filter(item => item !== 'audio'))];
        send('/startRecconect', ws, {tracksType, ...res});
        for (const u of room.users) {
            u.consumers = []
        }
    } catch(err) {
        console.error('handleRecconect error: ', err)
    }
}

export const handleTimeoutRemoveRoom = (roomId) => {
    try {
        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');
        room.broadcastAll({type: 'removeRoom'});
        rooms[roomId].destroy();
        delete rooms[roomId];

        console.log('ROOMS LENGTH - ', Object.values(rooms).length)
    } catch (err) {
        console.error('handleTimeoutRemoveRoom error: ', err);
    }
}


export const routes = {
    'create-room': handleCreateRoom,
    'create-producer': handleCreateProducer,
    'connect-transport': handleConnectTransport,
    'remove-room': handleRemoveRoom,
    'check-room': handleCheckRoom,
    'join-room': handleJoinRoom,
    'create-consumer': handleCreateConsumer,
    'mute-micro': muteMicro,
    'remove-producer': handleRemoveProducer,
    'send-message': handleSendMessage,
    'recconect': handleRecconect,
    'restart-sfu': handleRestartSFU
}


// active tab, other tab (user id one)
// if tab closed -> producer sleep
// if time < 300 && reload then id == producer id -> active tab
// 