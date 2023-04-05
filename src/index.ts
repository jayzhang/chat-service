import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

export class ChatServer {
  io: Server;
  start(){
    this.io = new Server({
      path: '/socket.io/'
    });
    this.io.on("connection", (socket) => {
      console.log(`<====connection: ${socket.id}`)
      socket.on('msg', (msg) => {
        console.log(`socket.on(msg): ${JSON.stringify(msg)}`)
      })
      socket.on("disconnecting", (reason) => {
        console.log(`<====disconnecting: ${reason}`)
      });
    });
    const pubClient = createClient({ url: "redis://localhost:6379" });
    const subClient = pubClient.duplicate();
    this.io.adapter(createAdapter(pubClient, subClient));
    this.io.listen(80);
  }
  stop(){
    this.io.close();
  }
}





