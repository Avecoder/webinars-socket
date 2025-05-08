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

const handleCreateRoom = async ({ ws }) => {
    try {
        const roomId = uuidv4();
  
        if (!rooms[roomId]) {
            const room = new Room(roomId);
            await room.initializeRouter();
        
            rooms[roomId] = room;

        
            room.addUser(ws);

           
        
            const transport = await room.createTransport(ws);
            const transportOptions = {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            };
            
            send('/roomCreated', ws, {
                roomId,
                transportOptions,
                routerRtpCapabilities: room.router.rtpCapabilities
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

 const handleCreateProducer = async ({ ws, roomId, kind, rtpParameters }) => {
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
      
        room.saveProducer(ws, producer);

        ws.role = 'producer'
        
        send('/producerCreated', ws, {
            producerId: producer.id,
            role: ws.role,
            roomId
        }) 
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
        const room = rooms[roomId];
        console.log(Object.keys(rooms), roomId)
        if (!room) throw new Error('Room not found');

        delete rooms[roomId];

    } catch(err) {
        console.error('handleRemoveRoom error: ', err)
    }
 }

 const handleCheckRoom = async ({ws, roomId}) => {
    try {
        const room = rooms[roomId];
        console.log(Object.keys(rooms))
        send('/roomStatus', ws, {isExist: !!room})

    } catch(err) {
        console.error('handleRemoveRoom error: ', err)
    }
 }

 const handleCreateConsumer = async ({ws, roomId}) => {
    try {
        
        // console.log('create consumer')

        const room = rooms[roomId];
        if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        const producerId = room.producers.map(data => data.producer.id)[0]

        const rtpCapabilities = room.router.rtpCapabilities;
        const transport = room.getTransport(ws);
        const producer = room.findProducerById(producerId);
        if (!producer) {
            send('/error', ws, {message: 'Producer not found' })
        }

        const canConsume = room.router.canConsume({ producerId, rtpCapabilities });
        if (!canConsume) {
            send('/error', ws, {message: 'Cannot consume' })
        }
        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: false
        });
      
        room.addConsumer(ws, consumer);

        send('/createConsumer', ws, {
            consumerParameters: {
                id: consumer.id,
                producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            }
        })
    } catch(err) {
        console.error('handleCreateConsumer error: ', err)
    }
 }

 const handleJoinRoom = async ({ws, roomId, producerId, rtpCapabilities}) => {
    try {
        const room = rooms[roomId];
        if (!room) throw new Error('Room not found');

        
        room.addUser(ws);

           
        
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




export const routes = {
    'create-room': handleCreateRoom,
    'create-producer': handleCreateProducer,
    'connect-transport': handleConnectTransport,
    'remove-room': handleRemoveRoom,
    'check-room': handleCheckRoom,
    'join-room': handleJoinRoom,
    'create-consumer': handleCreateConsumer
}