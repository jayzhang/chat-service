import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { Emitter } from "@socket.io/redis-emitter";

export class ChatServer {
  io: Server;
  async start(port: number){
    this.io = new Server({
      path: '/socket.io/'
    });

    const pubClient = createClient({ url: "redis://localhost:6379" });
    const subClient = pubClient.duplicate();

    const redisClient = createClient({ url: "redis://localhost:6379" });
    await redisClient.connect()
    const emitter = new Emitter(redisClient);

    this.io.on("connection", (socket) => {
      console.log(`<====connection: ${socket.id}  uid:${socket.handshake.auth.uid}`)
      
      socket.join("room1");
     
      this.io.of("/").adapter.on("create-room", (room) => {
        console.log(`room ${room} was created`);
      });

      this.io.of("/").adapter.on("join-room", (room, id) => {
        console.log(`socket ${id} has joined room ${room}`);
      });
      
      socket.on('msg', (msg) => {
        console.log(`socket.on(msg): ${JSON.stringify(msg)}`)
        console.log(`start to emit!`)
        emitter.to("room1").except(socket.id).emit("msg", msg);
      })
      socket.on("disconnecting", (reason) => {
        console.log(`<====disconnecting: ${reason}`)
      });
    });

    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
      this.io.adapter(createAdapter(pubClient, subClient));
      this.io.listen(port);
      console.log(`server start: ${port}`);
    });
  }
  stop(){
    this.io.close();
  }
}

const port = Number(process.argv[2]);

const chatServer = new ChatServer();

chatServer.start(port);


