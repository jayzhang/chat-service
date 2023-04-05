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

    // connect event
    this.io.on("connection", (socket) => {

      // get uid
      const uid = socket.handshake.auth.uid;
      
      socket.data.uid = uid;

      console.log(`<====connection: ${socket.id}  uid:${uid}`)
       
      // socket join room: uid
      socket.join(uid);

      // room event
      this.io.of("/").adapter.on("create-room", (room) => {
        console.log(`room '${room}' was created`);
      });
      this.io.of("/").adapter.on("join-room", (room, id) => {
        console.log(`socket '${id}' has joined room '${room}'`);
      });
      
      // msg event
      socket.on('msg', async (msg) => {
        const target = msg.target;
        console.log(`socket.on(msg): ${JSON.stringify(msg)}`)

        const sockets = await this.io.in(target).fetchSockets();

        console.log(`all sockets for uid:${target}`)
        for(const socket of sockets) {
          console.log(`id:${socket.id}, data: ${JSON.stringify(socket.data)}`);
        }

        emitter.to(target).emit("msg", msg);
      })

      // disconnect event
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


