import { Server, ServerOptions, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { Emitter } from "@socket.io/redis-emitter";


export interface ILogger { 
  info(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  log(message?: any, ...optionalParams: any[]): void;
  debug(message?: any, ...optionalParams: any[]): void; 
}

export class ConsoleLogger implements ILogger {
  info(message?: any, ...optionalParams: any[]): void {
    console.info(message, ...optionalParams);
  }
  error(message?: any, ...optionalParams: any[]): void{
    console.error(message, ...optionalParams);
  }
  warn(message?: any, ...optionalParams: any[]): void{
    console.warn(message, ...optionalParams);
  }
  log(message?: any, ...optionalParams: any[]): void{
    console.log(message, ...optionalParams);
  }
  debug(message?: any, ...optionalParams: any[]): void{
    console.debug(message, ...optionalParams);
  }
}


export interface IMessageListener {
  /**
   * 监听器id
   */
  id: string;

  /**
   * 发送给目标的event
   */
  targetEvent: string;
  /**
   * 同步给发送者的event，如果undefined，则不对消息进行同步
   */
  sourceEvent?: string;

  /**
   * 消息处理器
   * @param socket 
   * @param msg 
   * @param emitter 
   * @returns 
   */
  handlers: ((msg: IMessage, socket: Socket, emitter: Emitter, server: Server) => Promise<boolean> | boolean) [];
}
 
export type ISocketListener = (socket: Socket, other?: any) => Promise<boolean> | boolean;

export interface IMessage {
  id: string;
  source: string;
  target: string;
  content: string;
}

export function socketInfo(socket: Socket) {
  return `(id=${socket.id},data=${JSON.stringify(socket.data)})`
}

export interface ChatServerOptions extends ServerOptions{
  port: number;
  redisUrl: string;
  logger: ILogger;
}

export class DefaultChatServerOptions implements Partial<ChatServerOptions> {
  port = 8001;
  redisUrl = 'redis://localhost:6379';
  logger = new ConsoleLogger;
}

export class ChatServer {
  io: Server;
  options = new DefaultChatServerOptions();
  messageListeners: IMessageListener[] = [];

  connectionListener: ISocketListener = (socket: Socket) => { 
    const uid = socket.handshake.auth.uid;
    socket.data.uid = uid;
    return true;
  };

  disconnectingListener?: ISocketListener;

  registerMessageListener(listener: IMessageListener) {
    this.messageListeners.push(listener);
  }
  
  unregisterMessageListener(id: string) {
    this.messageListeners = this.messageListeners.filter(l=>l.id !== id);
  }
 
  constructor(opts?: Partial<ChatServerOptions>){
    if (opts) {
      Object.assign(this.options, opts)
    }
  }

  async start(){

    if (!this.messageListeners || this.messageListeners.length === 0) {
      throw new Error('please register message listeners');
    } 
    this.io = new Server(this.options as Partial<ServerOptions>);

    const pubClient = createClient({ url: this.options.redisUrl });
    const subClient = pubClient.duplicate();

    const redisClient = createClient({ url: this.options.redisUrl });
    await redisClient.connect()
    const emitter = new Emitter(redisClient);
 
    this.io.on("connection", async (socket) => {
      if (!await this.connectionListener(socket)) {
        socket.disconnect();
        return;
      }
      this.options.logger.info(`<====== [event: connection] socket: ${socketInfo(socket)}`)
      socket.join(socket.data.uid);
      socket.data.time = new Date().getTime();
      for(const listener of this.messageListeners) {
        socket.on(listener.targetEvent, async (msg: IMessage) => {
          msg.source = socket.data.uid;
          socket.data.time = new Date().getTime
          this.options.logger.info(`<====== [event:${listener.targetEvent}] socket:${socketInfo(socket)} msg: ${JSON.stringify(msg)}`)
          for(const handler of listener.handlers) {
            const success = await handler(msg, socket, emitter, this.io);
            if (!success) {
              return;
            }
          }
          //给接收端转发消息
          emitter.to(msg.target).emit(listener.targetEvent, msg);
          this.options.logger.info(`======> [event:${listener.targetEvent}, room:${msg.target}] msg: ${JSON.stringify(msg)}`)
          if (listener.sourceEvent) {
            //给发送端同步消息
            emitter.to(msg.source).emit(listener.sourceEvent, msg);
            this.options.logger.info(`======> [event:${listener.sourceEvent}, room:${msg.source}] msg: ${JSON.stringify(msg)}`)
          }
        })
      }
      // disconnect event
      socket.on("disconnecting", async (reason) => {
        if (this.disconnectingListener) {
          await this.disconnectingListener(socket, reason);
        }
        this.options.logger.info(`<====== [event: disconnecting] socket:${socketInfo(socket)} reason: ${reason}`)
      });
    });
    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
      this.io.adapter(createAdapter(pubClient, subClient));
      this.io.listen(this.options.port);
      this.options.logger.info(`server start: ${this.options.port}`);
    });
  }
  stop(){
    this.io.close();
  }
}

const port = Number(process.argv[2]);

const chatServer = new ChatServer({
  port: port,
});

chatServer.registerMessageListener({
  id: "1",
  targetEvent:"msg",
  sourceEvent:"msg",
  handlers: [
    async (msg: IMessage, socket: Socket, emitter: Emitter, server: Server) => {
      console.log(`listener: ${JSON.stringify(msg)}`)
      const sockets = await server.in(msg.target).fetchSockets();
      for(const socket of sockets) {
        console.log(`listener: 在线socket  id:${socket.id}, data: ${JSON.stringify(socket.data)}, rooms: ${Array.from(socket.rooms)}`);
      }
      return true;
    }
  ]
})
chatServer.start();


