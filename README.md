# 聊天服务

聊天服务对外启动两个服务，一个 web 服务和一个 web socket，两个服务监听同一个端口。

## 关于聊天身份gid

由于 helloboss 服务的用户会有4种身份，对于同一个用户的不同身份，在聊天服务中会对应多个不同的全局用户标识：gid。

这4类身份如下：
- 简历身份: 简历id为1的求职者的 gid 为 resume1
- boss身份: boss id为2的招聘者的 gid 为 boss2
- 客服身份: 客服的gid固定是css，目前只支持但个客服身份
- 社交身份: 用户uid=1社交身份 gid 为 social1

同一个用户uid作为不同 gid 身份之间的消息和会话都是相互隔离的。

## 关于会话 sessionId

会话 id 由一组 gid 对唯一命名，聊天会话是没有方向的, gid1跟gid2的聊天会话是同一个, 所以会话id在定义的时候，按照两个gid的字母序升序排列后组合: boss_css1, 保证唯一性。

## 聊天场景

### 求职者身份-招聘者身份

求职者跟招聘者之间的聊天，可以由任意一方发起，聊天会话id的格式: `boss${bossId}_resume${resumeId}`, 一个用户会有多个会话。

### 客服身份-社交身份

客服身份只能跟社交身份进行聊天。目前客服身份是固定一个，叫做`css`，客服人员的uid为固定值-1。目前暂不支持多客服聊天。

从用户社交身份的视角看，跟客服发起的聊天时候，每次固定给gid=`css`的用户发消息，会话id为：`css_social${用户uid}`。

当客服作为发送者时，消息体会包含客服的uid和gid作为身份识别:
```
{
  "source": "css",
  "sourceUid": 4,
  ...
}
```
sourceUid为使用客服身份的真实用户的uid。

当客服作为接收者时，消息体的目标uid会被系统置成-1，因为social用户在发消息时，并不知道是由哪个客服人员的账号接收，因此消息体会变成：
```
{
  "target": "css",
  "targetUid": -1,
  ...
}
```
此时，如果有客服人员在线，那么这个客服端会受到这条消息通知，一旦客服给用户进行了回复，用户侧才能看到具体的客服人员的账号。

## Web 服务

Web 服务提供聊天会话(`ChatSession`)和聊天消息(`ChatMessage`)的查询接口，具体参见 swagger-ui 的 API 文档定义。
该 Web 服务不直接提供对给 APP 调用，仅用于给 helloboss-service 提供会话和消息的查询接口。

## Socket 服务

Socket服务提供端到端的实时双向消息传输，传输协议使用socketio(https://socket.io/)。1

### 客户端接入

#### 浏览器中接入方式

```
<script src="xxx/socket.io.js"></script>
<script>
  const socket = io("https://api-dev.nga-x.com/", {
    auth: {
      token: "your auth token",
      gids: ['boss1', 'boss2']
    },
    path: '/helloboss-chat-service/socket.io/' 
  });
</script>
```

注意：

- 服务地址本地为："http://localhost:3000",  测试环境: "https://api-dev.nga-x.com/", 生产环境: "https://api-dev.nga-x.com/"。
- `authtoken`跟 APP 调用后台接口的统一登录的 token (跟访问后台接口的 HTTP header 中的`authorization`值相同)
- gids 对应helloboss用户gid列表

#### Nodejs 接入方式

```
const io = require("socket.io-client");
// or with import syntax
// import { io } from "socket.io-client";

const socket = io("https://api-dev.nga-x.com/", {
  auth: {
    token: "your auth token",
    gids: ['boss1', 'boss2]
  },
  path: '/helloboss-chat-service/socket.io/' 
});
```

#### 其他语言客户端接入方式

参见：https://socket.io/docs/v4

#### 消息收发示例代码

```
//发送通知
socket.emit('msg', {...});
//监听通知消息
socket.on('msg', function(event) {
  //处理已读通知
});
```

### 消息通道

消息通道一共有4种：消息(msg), 用户登录(user), 回执(rec), 心跳(hb)。
 - 消息msg: 传输聊天消息
 - 用户user: 传输用户上线、下线、已读等事件通知
 - 回执rec: 传输消息回执
 - 心跳hb: 传输心跳报文

#### 用户通道(user)


用户事件通道主要用户客户端之间同步消息的已读状态。当客户端收到已读通知时，需要根据对方的已读时间设置消息接受者的已读状态。
通知事件例子如下：
```
{
  "type": "read",
  "session":"boss1_resume2",
  "readerGid":"boss1",
  "targetUid": 3,
  "targetGid": "resume2",
  "readTime":1664979532597
}
```

#### 消息通道(msg)

客户端在登录聊天服务的时候需要声明自己的 gid 列表，作为接收消息的身份。

客户端发送消息示例

客户端发送消息时必须声明以下几个关键信息：

- source - 发送者的 gid，由于一个 uid 可以以不同身份非对方发消息，因此发送时必须要声明有以什么身份发出
- target - 接受者的 gid
- targetUid - 接受者的 uid

```
socket.emit('msg', {id: '111-222-333', source: 'boss1', target: 'resume2', targetUid: 1, content:'hello', type: 0});
```

发送的消息格式如下：

```
{
  "id": "111-222-333",
  "source": "boss1",  //应用标识
  "target": "resume2",   //消息接收者的gid
  "targetUid": 1,
  "content": "hello", //消息内容
  "type": 0
}
```

消息 type 字段表示消息类型，目前支持这几种消息类型：

- 0: 文本消息
- 1: 图片
- 2: 表情图片
- 3: 语音
- 4: 视频
- 5: 简历卡片，JSON 格式
- 6: 岗位卡片, JSON 格式
  发送消息时，如果 type 不设，默认是 0

客户端接收消息示例：

```
{
  "id": "111_22_33", 消息id
  "type": 0,
  "source":"boss1",   //发送者gid
  "sourceUid":3,   //发送者uid
  "target":"resume2",  //接收者gid
  "targetUid":1,   //接收者uid
  "content":"hello", //消息内容
  "sendTime":1628397863789,  //发送时间
  "session":"job1_resume2", //会话
  "gids":["job1", "resume2"],  //消息收发用户gid列表
  "uids":[3,1]  //消息收发用户uid列表
}
```

#### 心跳报文(hb)

虽然socketio在协议层面本身具有心跳机制，但是在业务层为了更灵活地实现长连接管理，我们单独定义了心跳报文的消息。
心跳报文消息格式如下：
```
{
  "id": "msg uuid"
}
```
心跳报文没有业务含义，仅仅包含了一个全局唯一的消息id，客户端需要向服务端按照约定频率相互发送心跳报文，以此来实现长连接的保活。如果客户端未按照约定时间发送心跳或者普通的业务消息报文，服务端会视为客户端已经不再存活，会主动关闭连接资源。
#### 回执通道(rec)

为了客户端和服务端更容易确认对方消息是否抵达，设置了消息的回执通道，回执消息格式如下：
```
{
  "id": "msg uuid"
}
```
回执消息体只有一个消息id，标识了该回执对应的消息id。
