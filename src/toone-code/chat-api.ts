import axios from "axios";
import { v4 as uuidv4 } from "uuid";

type chatApiError = {
    message: string,
};
type chatApiOption = {
    apiBaseUrl?: string,
    organization?: string,
};
type chatApiSendMessageOptions = {
    stream?: boolean,
    conversationId?: string,
    messageId?: string,
    parentMessageId?: string,
    systemMessage?: string,
    model?: string,
    onProgress?: (partialResponse: ChatMessage) => any,
    onDone?: (response: ChatMessage) => any,
    abortSignal?: AbortSignal,
    timeoutMs?: number,
    chatType?: ChatType,
    historyCount?: number,
    lang?: string,
    max_length?: number,
    cacheHistory?: boolean
};
interface ChatMessage {
    id: string;
    text: string;
    role: Role;
    name?: string;
    delta?: string;
    detail?: any;
    parentMessageId?: string;
    conversationId?: string;
    error?: string;
};
type CacheChatMessage = {
    messageId: string;
    userMessage?: ChatMessage;
    assistantMessage?: ChatMessage;
}
type Role = 'user' | 'assistant' | 'system';
type ChatType = 'chat' | 'code' | any;

export default class ChatApi {
    private _cacheChatMessage?: CacheChatMessage[];
    private _historyCount: number = 3;
    private readonly HUMAN_ROLE_START_TAG: string = "<s>human\n";
    private readonly BOT_ROLE_START_TAG: string = "<s>bot\n";
    private readonly ENDOFTEXT: string = "<|endoftext|>";

    constructor(opt: chatApiOption) {
        const { apiBaseUrl } = opt;
        this._cacheChatMessage = new Array();
        axios.defaults.baseURL = apiBaseUrl ?? 'http://codeserver.t.vtoone.com';
        axios.defaults.headers["Content-Type"] = "application/json";
    }

    async sendMessage(text: string, opts: chatApiSendMessageOptions): Promise<ChatMessage> {
        const {
            stream,
            onProgress,
            onDone,
            //conversationId = uuidv4(),
            //parentMessageId,
            messageId = uuidv4(),
            timeoutMs = 40 * 1000,
            chatType = "chat",
            historyCount = 3,
            cacheHistory = true
        } = opts;
        this._historyCount = historyCount;
        let { abortSignal } = opts;
        let abortController = null;
        if (timeoutMs && !abortSignal) {
            abortController = new AbortController();
            abortSignal = abortController.signal;
        }
        const message: ChatMessage = {
            role: "user",
            id: messageId,
            parentMessageId: messageId,
            text
        };
        const result: ChatMessage = {
            role: "assistant",
            id: uuidv4(),
            parentMessageId: messageId,
            text: "",
            error: ""
        };

        let config: axios.AxiosRequestConfig<any> = {
            method: 'post',
            url: '/chat',
            timeout: timeoutMs,
            signal: abortSignal,
        };
        if (stream) {
            config.responseType = "stream";
            config.url += "_stream_v1";

            cacheHistory && await this._updateMessages(message);

            const requestMsg = await this.buildMessages(text, opts);
            await this.doRequestPost(config, requestMsg).then((response) => {
                if (onProgress) {
                    response.data.on('data', (chunk: any) => {
                        // 处理流数据的逻辑
                        result.text = chunk.toString();
                        onProgress == null ? void 0 : onProgress(result);
                    });
                }
                if (onDone) {
                    response.data.on('end', async () => {
                        // 数据接收完成的逻辑
                        let rs = onDone == null ? void 0 : onDone(result);
                        if (rs === false) { return; }
                        cacheHistory && await this._updateMessages(result);
                    });
                }
                response.data.on('error', (error: any) => {
                    if (axios.isCancel(error)) {
                        console.log('请求被取消', error.message);
                    } else {
                        console.log('请求出错', error.message);
                    }
                    result.error = "服务异常，请稍后再试 " + error;
                    onDone == null ? void 0 : onDone(result);
                });
            }).catch(err => {
                result.error = "服务异常，请稍后再试. " + err;
                onDone == null ? void 0 : onDone(result);
            });
        }
        else {
            const response = await this.doRequestPost(config, {});
            result.text = response.data;
            onDone == null ? void 0 : onDone(result);
        }
        return result;
    };

    public async buildMessages(text: string, opts: chatApiSendMessageOptions) {
        const { chatType = "chat", lang } = opts;
       
        if (chatType === "chat") {
            text = this.combineMessageWithTAG(text);
        }
        return { lang, chatType, "prompt": text, };
    };
    public combineMessageWithTAG(text: string) {
        /**下面这拼接，可以根据历史上下文来不断地回答问题 */
        /*
            <s>system
            这是System指令
            <s>human
            这是第1轮用户输入的问题
            <s>bot
            这是第1轮模型生成的内容<|endoftext|>
            <s>human
            这是第2轮用户输入的问题
            <s>bot
            这是第2轮模型生成的内容<|endoftext|>
            ...
            <s>human
            这是第n轮用户输入的问题
            <s>bot
            {模型现在要生成的内容}<|endoftext|>
        */
        // if (this._cacheChatMessage?.length > 0) {
        //     let prompt = "";
        //     this._cacheChatMessage.forEach((item, index) => {
        //         if (item.userMessage?.text) {
        //             prompt += `${this.HUMAN_ROLE_START_TAG}${item.userMessage?.text}`;
        //         }
        //         if (item.assistantMessage?.text) {
        //             prompt += `${this.BOT_ROLE_START_TAG}${item.assistantMessage?.text}${this.ENDOFTEXT}\n`;
        //         }
        //     });
        //     if (prompt) {
        //         text = prompt;
        //     }
        // } else {
        //     text = `${this.HUMAN_ROLE_START_TAG}${text}`;
        // }
        //text = `${text}\n${this.BOT_ROLE_START_TAG}`;
        text = `${this.HUMAN_ROLE_START_TAG}${text}\n${this.BOT_ROLE_START_TAG}`;
        return text;
    }
    private async _updateMessages(message: ChatMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this._cacheChatMessage) {
                return resolve(void 0);
            }
            try {
                if (message.role === 'user') {
                    //超出指定范围，需要清理掉一下
                    if (this._cacheChatMessage.length >= this._historyCount) {
                        while (this._cacheChatMessage.length >= this._historyCount) {
                            this._cacheChatMessage.splice(0, 1);
                        }
                    }
                    this._cacheChatMessage.push({
                        messageId: message.id,
                        userMessage: message
                    });
                }
                else {
                    let exist = this._cacheChatMessage.find(f => f.messageId === message.parentMessageId);
                    if (exist) {
                        exist.assistantMessage = message;
                    }
                }
                resolve(message);
            } catch (err) {
                reject(err);
            }
        }).catch(err => {
            console.error(err);
        });
    }
    public async clearCacheMessage(): Promise<any> {
        this._cacheChatMessage = undefined;
    }
    private doRequestPost(config: axios.AxiosRequestConfig<any>, data: any): Promise<axios.AxiosResponse<any, any>> {
        return axios.post(config.url || "", data, config);
    }
}
