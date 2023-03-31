import { EnvConfig, Logger, PostConstruct, Service } from '@summer-js/summer'
import { Repository } from '@summer-js/typeorm'
import { RedisClient } from '@summer-js/redis'
import { randomUUID } from 'crypto'
import { Socket } from 'socket.io'
import { ChatSocketError } from '@/error'
import {
  ChatMessage,
  ChatRecMessage,
  ChatSession,
  MsgFormatType,
  NotifyReadRequest,
  RedisKeys,
  SocketEvent,
  UserInfo
} from '../dto/request'
import { ChatSessionState, CorpUser, CustomerServiceStuff, Resume, Gender } from '@/entity'
import { FcmService, LinkType, GreetingService, UserService, ElasticsearchService } from '@/service'

import { convertImageUrlTo100x100 } from '../utils'
import { DEBUG_ALL_MESSAGE, REPLY_TIMEOUT } from './Constants'
import { ISession } from './SessionTracker'
import { EmailService } from './EmailService'

@Service
export class ChatService {
  awsConfig: EnvConfig<'AWS_CONFIG'>

  redisClient: RedisClient
  eventSubscriber: RedisClient

  elasticsearchService: ElasticsearchService
  greetingService: GreetingService
  fcmService: FcmService
  userService: UserService
  emailService: EmailService

  resumeRepository: Repository<Resume>
  corpUserRepository: Repository<CorpUser>
  customerServiceStuffRepository: Repository<CustomerServiceStuff>
  chatSessionStateRepository: Repository<ChatSessionState>

  gid2socketIds = new Map<string, Set<string>>() // gid--->socket id set
  socketMap = new Map<string, Socket>() // socket id--->socket
  sendingMsgs = new Map<string, ChatMessage>() //发送中的消息id集合

  @PostConstruct
  async init() {
    if (process.env.SUMMER_ENV === 'test') return
    // 未应答的消息处理
    setInterval(() => {
      this.checkSendingMsgs()
    }, 60000)

    const redisSubscriberHandler = (channel, message) => {
      Logger.info(`<=== recv_from_redis_${channel}, message:${message}`)
      try {
        const msg = JSON.parse(message)
        if (channel === RedisKeys.MSG) {
          const chatMsg = msg as ChatMessage
          Logger.info(`onMessage::<=== recv_from_redis_${channel}, message id:${chatMsg.id}, body: ${message}`)
          const socketIds = this.gid2socketIds.get(chatMsg.target)
          if (socketIds) {
            Logger.info(`onMessage::===> 本地找到target用户:${chatMsg.target}, 直接发送消息:${message}`)
            this.sendMsg(msg, socketIds)
          } else {
            Logger.info(`onMessage::===> 本地未找到target用户:${chatMsg.target}, 忽略消息:${message}`)
          }
        } else if (channel === RedisKeys.UserEvent && msg.type === 'read') {
          const eventMsg = msg as NotifyReadRequest
          Logger.info(`notifyRead::<=== recv_from_redis_${channel}, body: ${message}`)
          const socketIds = this.gid2socketIds.get(eventMsg.targetGid)
          if (socketIds) {
            Logger.info(`===>本地找到target用户:${eventMsg.targetGid}, 直接发送消息:${message}`)
            this.sendUserEvent(eventMsg, socketIds)
          } else {
            Logger.info(`===>本地未找到target用户:${eventMsg.targetGid}, 忽略消息:${message}`)
          }
        }
      } catch (e) {
        Logger.error(`failed_to_parse_json_string_from_redis_channel: ${channel}, message: ${message}, error: ${e}`)
      }
    }

    Logger.info(`订阅redis分发channel:${RedisKeys.MSG}, ${RedisKeys.UserEvent}`)
    this.eventSubscriber = this.redisClient.duplicate()
    await this.eventSubscriber.subscribe(RedisKeys.MSG, RedisKeys.UserEvent)
    this.eventSubscriber.on('message', redisSubscriberHandler)
  }

  redisKey(gid: string) {
    return `hb.alive.${gid}`
  }

  /**
   * redis保活
   */
  async keepAliveInRedis(gid: string, seconds: number) {
    if (DEBUG_ALL_MESSAGE)
      Logger.info(`keepAliveInRedis:${gid}, seconds: ${seconds}`);
    const key = this.redisKey(gid)
    await this.redisClient.setex(key, seconds, gid)
  }

  async isAliveInRedis(gid: string) {
    const key = this.redisKey(gid)
    const res = await this.redisClient.get(key)
    if (res === null || res === undefined || res === '') return false
    return true
  }

  async delAliveInRedis(gid: string) {
    if (DEBUG_ALL_MESSAGE)
      Logger.info(`delAliveInRedis:${gid}`)
    const key = this.redisKey(gid)
    await this.redisClient.del(key)
  }

  async onlineUser(session: SocketSession) {
    const user = session.socket.data as UserInfo
    if (user && user.gids) {
      let conNum = 0
      for (const gid of user.gids) {
        let socketIds = this.gid2socketIds.get(gid)
        if (!socketIds) {
          socketIds = new Set<string>()
          this.gid2socketIds.set(gid, socketIds)
        }
        socketIds.add(session.socket.id)
        conNum += socketIds.size
      }
      Logger.info(`onlineUser: ${JSON.stringify(user)}, 内存中连接数:${conNum}`)
    }
    this.socketMap.set(session.socket.id, session.socket)
  }
  async offlineUser(session: SocketSession, reason?: string) {
    const user = session.socket.data as UserInfo
    Logger.info(`offlineUser: ${JSON.stringify(user)}, 原因: ${reason}`)
    if (user && user.gids) {
      for (const gid of user.gids) {
        const socketIds = this.gid2socketIds.get(gid)
        if (socketIds && socketIds.has(session.socket.id)) {
          socketIds.delete(session.socket.id)
          if (socketIds.size === 0) {
            this.gid2socketIds.delete(gid)
          }
        }
      }
    }
    this.socketMap.delete(session.socket.id)
  }

  checkSendingMsgs() {
    // Logger.info(`checkSendingMsgs:${this.sendingMsgs.size}`);
    const now = new Date().getTime()
    for (const msgId of this.sendingMsgs.keys()) {
      const msg = this.sendingMsgs.get(msgId)
      if (msg && now - msg.sendTime! >= REPLY_TIMEOUT) {
        //1分钟还未收到回执，认为离线，则发送APN推送
        // Logger.info(`消息回执超时，发送外部APN推送, msg: ${JSON.stringify(msg)}`) //未收到回执的消息暂时不触发APN推送
        // this.sendApnPush(msg)
        this.sendingMsgs.delete(msgId)
      }
    }
  }

  onReply(msg: ChatRecMessage) {
    this.sendingMsgs.delete(msg.id) //删除发送状态的消息
  }

  async sendMsg(msg: ChatMessage, socketIds: Set<string>) {
    let needAPN = false;
    for (const socketId of socketIds) {
      const socket = this.socketMap.get(socketId)
      if (socket) {
        socket.emit(SocketEvent.MSG, msg)
        Logger.info(`onMessage::====>send_to_socket (socket id:${socket.id}, isPush: ${socket.data.isPush}, data:${JSON.stringify(socket.data)}) , msg: ${JSON.stringify(msg)}`)
        if (socket.data.isPush === 1) {
          //在线用户也需要发送app推送
          needAPN = true;
        }
        this.sendingMsgs.set(msg.id!, msg)
      } else {
        Logger.error(`socket not found: ${socketId}`)
      }
    }
    if (needAPN) {
      await this.sendApnPush(msg);
      Logger.info(`onMessage::====>send_to_push target=${msg.target} 设置了isPush=1, 发送APN推送, msg: ${JSON.stringify(msg)}`)
    }
  }
  sendUserEvent(msg: NotifyReadRequest, socketIds: Set<string>) {
    for (const socketId of socketIds) {
      const socket = this.socketMap.get(socketId)
      if (socket) {
        const finalMsg = { ...msg, type: 'read' };
        socket.emit(SocketEvent.USER, finalMsg)
        Logger.info(`notifyRead::====>send_to_socket (socket id:${socket.id}, isPush: ${socket.data.isPush}, data:${JSON.stringify(socket.data)}) , msg: ${JSON.stringify(finalMsg)}`)
      }
    }
  }
  async notifyRead(req: NotifyReadRequest) {
    const session = await this.elasticsearchService.getChatSession(req.session)
    if (session && session.gids) {
      for (const gid of session.gids) {
        if (gid !== req.readerGid) {
          const socketIds = this.gid2socketIds.get(gid)
          if (socketIds && socketIds.size > 0) {
            Logger.info(
              `====>本地找到在线的target用户:${gid}, 连接客户端:${Array.from(socketIds)}}, 直接发送已读通知`
            )
            this.sendUserEvent(req, socketIds)
          } else {
            const alive = await this.isAliveInRedis(gid)
            if (alive) {
              //用户在线，可能连接了其他服务器
              Logger.info(`====>本地未找到target用户:${gid}, 查询缓存用户在线，发送已读通知到redis`)
              await this.redisClient.publish(RedisKeys.UserEvent, JSON.stringify(req)) //消息转发通道
              Logger.info(`notifyRead::====>send_to_redis_${RedisKeys.UserEvent}, msg: ${JSON.stringify(req)}`)
            }
          }
        }
      }
    }
  }
  async validateChatMsg(msg: ChatMessage) {
    if (msg.source === undefined) {
      throw new ChatSocketError('MessageValidationFailed', 'message.source is undefined')
    }
    const validateSource = await this.userService.validateGidFormatAndExistence(msg.sourceUid!, [msg.source])
    if (validateSource) {
      throw new ChatSocketError(
        'MessageValidationFailed',
        `uid=${msg.sourceUid}, gid=${msg.source} validation failed: ${validateSource}`
      )
    }
    if (msg.target === undefined) {
      throw new ChatSocketError('MessageValidationFailed', 'message.target is undefined')
    }
    if (msg.targetUid === undefined) {
      throw new ChatSocketError('MessageValidationFailed', 'message.targetUid is undefined')
    }
    const validateTarget = await this.userService.validateGidFormatAndExistence(msg.targetUid!, [msg.target])
    if (validateTarget) {
      throw new ChatSocketError(
        'MessageValidationFailed',
        `uid=${msg.targetUid}, gid=${msg.target} validation failed: ${validateTarget}`
      )
    }
    if (msg.content === undefined) {
      throw new ChatSocketError('MessageValidationFailed', 'message.content is undefined')
    }
  }
  async onMessage(msg: ChatMessage) {
    msg.sendTime = new Date().getTime()
    if (msg.id === undefined) {
      msg.id = randomUUID()
    }
    Logger.info(`onMessage_start_${msg.id}`)
    if (msg.type === undefined) {
      msg.type = MsgFormatType.Text
    }
    msg.gids = [msg.source, msg.target]
    msg.uids = [msg.sourceUid!, msg.targetUid]
    msg.session = generateSessionId(msg.source, msg.target)
    await this.validateChatMsg(msg)
    if (msg.target === 'css') msg.targetUid = -1 //给客服发的消息对方uid固定是-1
    const session = new ChatSession()
    session.id = msg.session
    session.gids = msg.gids
    session.uids = [msg.sourceUid!, msg.targetUid!]
    session.createTime = new Date().getTime()

    await this.elasticsearchService.ensureChatSession(session) //记录聊天会话表

    //持久化消息
    await this.elasticsearchService.writeChatMessage(msg)

    //分发消息
    await this.dispatchMsg(msg)

    //异步处理自动回复
    this.processAutoReply(msg)

    //异步处理邮件发送
    this.processSendEmail(msg)
    
    Logger.info(`onMessage_end_${msg.id}`)
    return msg.id
  }

  async processAutoReply(chatMessage: ChatMessage) {
    if (
      chatMessage.type !== MsgFormatType.JSON_JOB_INFO &&
      chatMessage.type !== MsgFormatType.JSON_RESUME &&
      !chatMessage.isAutoReply &&
      typeof chatMessage.target === 'string' &&
      chatMessage.target.startsWith('boss')
    ) {
      //非卡片类型的消息，并且接收方式招聘者时才需要自动回复
      const autoReplyMsg = await this.greetingService.getAutoReplyContent(chatMessage.targetUid)
      if (autoReplyMsg) {
        //需要自动给发送者发送一条回复消息
        const replyMsg = new ChatMessage()
        replyMsg.sourceUid = chatMessage.targetUid
        replyMsg.targetUid = chatMessage.sourceUid!
        replyMsg.target = chatMessage.source
        replyMsg.source = chatMessage.target
        replyMsg.content = autoReplyMsg
        replyMsg.isAutoReply = true;
        Logger.info(
          `onMessage::send auto-reply message: ${JSON.stringify(replyMsg)}`
        )
        await this.onMessage(replyMsg)
      }
    }
  }

  /**
   * 检查发送邮件的条件并进行发送
   */
  async processSendEmail(chatMessage: ChatMessage) {
    if (
      chatMessage.type !== MsgFormatType.JSON_JOB_INFO &&
      chatMessage.type !== MsgFormatType.JSON_RESUME &&
      !chatMessage.isAutoReply
    ) { //只针对人工消息作处理
      if (chatMessage.source.startsWith('boss') && chatMessage.target.startsWith('resume')) {
        const resumeId = Number(chatMessage.target.substring(6))
        const bossId = Number(chatMessage.source.substring(4))
        const count = await this.elasticsearchService.countManualMessagesAsReceiver(chatMessage.target, chatMessage.session!);
        if (count === 1) {
          await this.emailService.sendEmailToResume(bossId, resumeId)
        }
      } else if (chatMessage.source.startsWith('resume') && chatMessage.target.startsWith('boss')) {
        const resumeId = Number(chatMessage.source.substring(6))
        const bossId = Number(chatMessage.target.substring(4))
        const count = await this.elasticsearchService.countManualMessagesAsReceiver(chatMessage.target, chatMessage.session!);
        if (count === 1) {
          await this.emailService.sendEmailToBoss(bossId, resumeId)
        }
      }
    }
  }

  /**
   * 1. 本地在线，直接转发
   * 2. 本地不在线，其他服务在线，转发到redis
   * 3. 本地不在线，其他服务也不在线，发送APN推送
   */
  async dispatchMsg(msg: ChatMessage) {
    const contextIds = this.gid2socketIds.get(msg.target)
    if (contextIds && contextIds.size > 0) {
      Logger.info(
        `onMessage::====>[dispatchMsgForOnlineUser]本地找到在线的target用户:${msg.target}, 连接客户端:${Array.from(
          contextIds
        )}}, 直接发送消息:${msg.id}`
      )
      this.sendMsg(msg, contextIds)
    } else {
      const alive = await this.isAliveInRedis(msg.target)
      if (alive) {
        //用户在线，可能连接了其他服务器
        Logger.info(
          `onMessage::====>[dispatchMsgForOnlineUser]本地未找到target用户:${msg.target}, 查询缓存用户在线，发送到redis消息转发通道:${msg.id}`
        )
        await this.redisClient.publish(RedisKeys.MSG, JSON.stringify(msg)) //消息转发通道
      } else {
        //用户不在线，发送APN
        Logger.info(
          `onMessage::====>[dispatchMsgForOfflineUser]本地未找到target用户:${msg.target}, 查询缓存用户不在线，发送APN外部推送:${msg.id}`
        )
        this.sendApnPush(msg)
      }
    }
  }
  getDefaultAvatar(gender: Gender) {
    return `${this.awsConfig.cdn}/system/avatar/${Gender[gender].toLowerCase()}.jpg`
  }

  /**
   * 批量查询用户所有的聊天会话的读取时间(取readTime和deleteTime的最大值)
   */
  async getUserChatSessionsWithTime(uid: number) {
    const entities = await this.chatSessionStateRepository.findBy({ uid: uid })
    const results: any[] = []
    for (const e of entities) {
      results.push({ session: e.sessionId, deleteTime: e.deleteTime, readTime: e.readTime })
    }
    return results
  }

  // 获取未读取的消息数量总数
  async countUnreadMsgs(uid: number, scenario: 'admin-css' | 'app-css' | 'app-chat') {
    let myGids: string[] = []
    let otherGids: string[] = []
    let otherGidPrefixes: string[] = []
    if (scenario === 'admin-css') {
      //myGids = css, otherGid = social???
      myGids = ['css']
      otherGidPrefixes = ['social']
      uid = -1
    } else if (scenario === 'app-css') {
      //myGids = social${uid}, otherGid = css
      myGids = [`social${uid}`]
      otherGids = ['css']
    } else if (scenario === 'app-chat') {
      //myGids = social${uid}, boss${bossId}, resume${resumeId}, otherGid = social???, boss???, resume???
      myGids = await this.userService.getUserGids(uid)
      otherGidPrefixes = ['boss', 'resume', 'social']
    }
    const sessionStates = await this.getUserChatSessionsWithTime(uid)
    const chatNumRes = await this.elasticsearchService.countUnreadMsgs({
      uid: uid,
      gids: myGids,
      otherGids: otherGids,
      otherGidPrefixes: otherGidPrefixes,
      sessionStates: sessionStates
    })
    const total = chatNumRes.total
    return total
  }
  async sendApnPush(chatMessage: ChatMessage) {
    const sender = await this.userService.getUserWithFields(chatMessage.sourceUid!, ['id', 'name'])
    if (sender && chatMessage.content) {
      const msgFormat = chatMessage.type
      if (msgFormat === MsgFormatType.JSON_JOB_INFO || msgFormat === MsgFormatType.JSON_RESUME) {
        Logger.info(`onMessage::[APN]忽略卡片消息推送: ${JSON.stringify(chatMessage)}`)
        //卡片不推送
        return
      }
      let msgContent = chatMessage.content
      if (msgContent.length > 60) {
        //截取最大长度60
        msgContent = `${msgContent.substring(0, 60)}...`
      }
      if (msgFormat === MsgFormatType.EmojiImage) {
        //表情处理
        // const stickerId = Number(msgContent)
        msgContent = '[表情]'
        // const sticker = await this.stickerService.get(stickerId);
        // if (sticker) {
        //   msgContent = `[${sticker.name}]`;
        // } else {
        //   msgContent = '[]';
        // }
      } else if (msgFormat === MsgFormatType.Image) {
        //图片处理
        msgContent = '[写真]'
      }
      let senderName = sender.name
      let avatar
      if (typeof chatMessage.source === 'string' && chatMessage.source.startsWith('resume')) {
        //填充简历信息
        const resumeId = Number(chatMessage.source.substring(6))
        const resume = await this.resumeRepository.findOneBy({ id: resumeId })
        if (resume) {
          senderName = resume.baseInfo.name || senderName
          avatar = resume.baseInfo.avatar || this.getDefaultAvatar(resume.baseInfo.gender!)
        }
      } else if (typeof chatMessage.source === 'string' && chatMessage.source.startsWith('boss')) {
        const bossId = Number(chatMessage.source.substring(4))
        const corpUser = await this.corpUserRepository.findOneBy({ id: bossId })
        if (corpUser) {
          senderName = corpUser.name
          avatar = corpUser.avatar || this.getDefaultAvatar(corpUser.gender)
        }
      }
      const pushBody = `${senderName}:${msgContent}`
      const imageUrl = avatar ? convertImageUrlTo100x100(avatar) : undefined

      let targetUids: number[] = [chatMessage.targetUid]
      let cssUnreadNum
      if (chatMessage.targetUid === -1) {
        //接收方是客服，需要把targetUids设置成所有客服人员的uid列表
        targetUids = (await this.customerServiceStuffRepository.find())
          .filter((css) => css.state === 1)
          .map((css) => css.id)
        cssUnreadNum = await this.countUnreadMsgs(-1, 'admin-css')
      }
      let pushTime;
      for (const targetUid of targetUids) {
        let unreadNum = cssUnreadNum
        if (chatMessage.targetUid !== -1) {
          const count1 = await this.countUnreadMsgs(targetUid, 'app-chat')
          const count2 = await this.countUnreadMsgs(targetUid, 'app-css')
          unreadNum = count1 + count2
        }
        const receiver = (await this.userService.getUserWithFields(targetUid, ['fcmToken']))!
     
        if (receiver && receiver.fcmToken) {
          pushTime = new Date().getTime() // pushTime记录的是开始调用推送服务的时间
          Logger.info(`onMessage::===>[APN]开始调用publishToOneUser中, targetUid:${targetUid}, unreadNum: ${unreadNum}, receiver: ${JSON.stringify(receiver)}`)
          this.fcmService.publishToOneUser(
            receiver.fcmToken,
            '新しいメッセージが届きました！',
            pushBody,
            {
              type: LinkType.Internal,
              url: 'Chat:' + chatMessage.session,
              externalUrl: ''
            },
            unreadNum,
            imageUrl
          )
        } else {
          // 用户没有打开推送通知
        }
      }
      if (pushTime) {
        chatMessage.pushTime = pushTime;
        await this.elasticsearchService.updateMessagePushTime(chatMessage)
      }
    } else {
      Logger.info(`onMessage::==>[APN]调用失败, sender不存在或者内容不存在`)
    }
  }
}

export function generateSessionId(gid1: string, gid2: string) {
  const sid = [gid1, gid2].sort().join('_')
  return sid
}

export class SocketSession implements ISession {
  socket: Socket
  chatService: ChatService

  constructor(socket: Socket, chatService: ChatService) {
    this.socket = socket
    this.chatService = chatService
  }

  getId(): string {
    return this.socket.id
  }
  getGids(): string[] {
    return (this.socket.data as UserInfo).gids
  }
  setExpireTime(time: number): void {
    this.socket.data.nextExpireTime = time
    const expInSeconds = parseInt(`${(time - new Date().getTime()) / 1000}`)
    // Logger.info(`[session.setExpireTime] gid: ${this.socket.data.gids} set new expire time: ${time}, expInSeconds=${expInSeconds}`)
    if (expInSeconds > 0) {
      const gids = (this.socket.data as UserInfo).gids
      if (gids) {
        for (const gid of gids) {
          this.chatService.keepAliveInRedis(gid, expInSeconds)
        }
      }
    }
  }
  getExpireTime(): number {
    return this.socket.data.nextExpireTime
  }
  async close(reason?: string | undefined): Promise<void> {
    Logger.info(`===> SocketSession.close():${JSON.stringify(this.socket.data as UserInfo)}, reason: ${reason}`)
    const gids = (this.socket.data as UserInfo).gids
    if (gids) {
      for (const gid of gids) {
        this.chatService.delAliveInRedis(gid)
      }
    }
    await this.chatService.offlineUser(this, reason)
    this.socket.disconnect(true)
  }
}
