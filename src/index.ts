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


export interface ChatMessage {
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
  enableRedisAdapter: boolean;
  redisUrl: string;
  messageEventName: string;
  messageSyncEventName: string;
  logger: ILogger;
}

export class DefaultChatServerOptions implements Partial<ChatServerOptions> {
  port = 80;
  redisUrl = 'redis://localhost:6379';
  messageEventName = 'msg';
  messageSyncEventName = 'msg';
  logger = new ConsoleLogger;
}

export class ChatServer {
  io: Server;

  options = new DefaultChatServerOptions();

  /**
   * 连接处理器，处理用户认证逻辑
   */
  onConnectHandler: (socket: Socket) => Promise<boolean> | boolean = (socket) => {
    const uid = socket.handshake.auth.uid;
    socket.data.uid = uid;
    return true;
  };

  /**
   * 消息处理器，可以有多个
   */
  onMessageHandlers: ((socket: Socket, event: string, msg: ChatMessage, emitter: Emitter) => Promise<boolean> | boolean )[] = [];

  constructor(opts?: Partial<ChatServerOptions>){
    if (opts) {
      Object.assign(this.options, opts)
    }
  }

  async start(){
    this.io = new Server(this.options as Partial<ServerOptions>);

    const pubClient = createClient({ url: this.options.redisUrl });
    const subClient = pubClient.duplicate();

    const redisClient = createClient({ url: this.options.redisUrl });
    await redisClient.connect()
    const emitter = new Emitter(redisClient);

    // connect event
    this.io.on("connection", async (socket) => {
  
      let success = await this.onConnectHandler(socket);

      if (!success) {
        socket.disconnect();
      }

      this.options.logger.info(`<====== [event: connection] socket: ${socketInfo(socket)}`)

      socket.join(socket.data.uid);

      // msg event
      socket.on(this.options.messageEventName, async (msg) => {
        this.options.logger.info(`<====== [event:${this.options.messageEventName}] socket:${socketInfo(socket)} msg: ${JSON.stringify(msg)}`)
        msg.source = socket.data.uid;

        const chatMsg = msg as ChatMessage;

        for(const handler of this.onMessageHandlers) {
          success = await handler(socket, this.options.messageEventName, chatMsg, emitter);
          if (!success) {
            return;
          }
        }

        const target = msg.target;

        //给接收端转发消息
        emitter.to(target).emit(this.options.messageEventName, msg);
        this.options.logger.info(`======> [event:${this.options.messageEventName}, room:${target}] msg: ${JSON.stringify(msg)}`)

        //给发送端同步消息
        emitter.to(msg.source).emit(this.options.messageSyncEventName, msg);
        this.options.logger.info(`======> [event:${this.options.messageSyncEventName}, room:${msg.source}] msg: ${JSON.stringify(msg)}`)
      })

      // disconnect event
      socket.on("disconnecting", (reason) => {
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
  port: port
});

chatServer.onMessageHandlers.push(
  (socket: Socket, event: string, msg: ChatMessage, emitter: Emitter) =>{
    console.log(`处理消息: ${JSON.stringify(msg)}`);
    return true;
  }
);

chatServer.start();


