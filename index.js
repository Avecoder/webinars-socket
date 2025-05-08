import WebSocket, {WebSocketServer} from "ws";
import dotenv from 'dotenv'
dotenv.config()
import { routes } from "./actions.js";


export const PORT = process.env.WS_PORT || 5555;


export const webSocket = new WebSocketServer({port: PORT})

const action = (message, ws) => {
    try {
        const {route, data} = JSON.parse(message)
        if(routes[route]) {
            routes[route]({...data, ws})
        } else {
            console.log('Not found route - ', route)
        }
        
    } catch (err) {
        console.error('Action err: ', err)
    }
}


webSocket.on('connection', (ws) => {
    console.log('A user connected');
    

    
    ws.on('message', (message) =>  action(message, ws));
  
    // Когда клиент закрывает соединение
    ws.on('close', () => {
      
      console.log('close')
    });
  });