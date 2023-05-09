'use client';

import type { FC, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { fetchApiChat } from '@/utils/api';
import { getCache, setCache } from '@/utils/cache';
import type { ChatResponse, Message } from '@/utils/constants';
import { Model, Role } from '@/utils/constants';
import { isMessage } from '@/utils/message';
import { isOldMessage, upgradeMessage } from '@/utils/messageUpgrade';
import { gapToBottom, getIsScrolling, scrollToBottom } from '@/utils/scroll';
import { sleep } from '@/utils/sleep';

import { MenuContext, MenuKey } from './MenuContext';

/**
 * 聊天记录
 */
export interface HistoryItem {
  messages: (Message | ChatResponse)[];
}

/**
 * 对话相关的 Context
 */
export const ChatContext = createContext<{
  sendMessage: (content: string) => Promise<void>;
  isLoading: boolean;
  messages: (Message | ChatResponse)[];
  history: HistoryItem[] | undefined;
  historyIndex: 'empty' | 'current' | number;
  loadHistory: (historyIndex: number) => void;
  deleteHistory: (historyIndex: 'current' | number) => void;
  startNewChat: () => void;
} | null>(null);

export const ChatProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { setIsMenuShow, setCurrentMenu } = useContext(MenuContext)!;
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<(Message | ChatResponse)[]>([]);
  const [history, setHistory] = useState<HistoryItem[] | undefined>(undefined);
  // 当前选中的对话在 history 中的 index，empty 表示未选中，current 表示选中的是当前对话
  const [historyIndex, setHistoryIndex] = useState<'empty' | 'current' | number>('empty');

  // 页面加载后从 cache 中读取 history 和 messages
  // 如果 messages 不为空，则将最近的一条消息写入 history
  useEffect(() => {
    let history = getCache<HistoryItem[]>('history');
    // 读取的 history 有可能是旧版的格式，这里做一个转换
    if (history !== undefined && history.length > 0 && isOldMessage(history[0].messages[0])) {
      history = history.map((historyItem) => ({
        messages: historyItem.messages.map(upgradeMessage),
      }));
    }
    // 读取的 messages 有可能是旧版的格式，这里做一个转换
    let messages = getCache<(Message | ChatResponse)[]>('messages');
    if (messages !== undefined && isOldMessage(messages)) {
      messages = messages.map(upgradeMessage);
    }

    // 如果检测到缓存中有上次还未存储到 cache 的 message，则加入到 history 中
    if (messages && messages.length > 0) {
      history = [{ messages }, ...(history ?? [])];
      setHistory(history);
      setCache('history', history);
      setMessages([]);
      setCache('messages', []);
    }

    // 根据 history 是否存在决定当前 menu tab 是什么
    if (history === undefined) {
      // 如果不存在 history，则当前 menu 是参数配置 tab
      setHistory([]);
      setCurrentMenu(MenuKey.AdjustmentsHorizontal);
    } else {
      // 如果存在 history，则当前 menu 是聊天记录 tab
      setHistory(history);
      setCurrentMenu(MenuKey.InboxStack);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string) => {
      // 先获取旧的 messages 的备份
      let newMessages = [...messages];
      // 如果当前是在浏览聊天记录，则激活历史消息
      if (typeof historyIndex === 'number') {
        const newHistory = [...(history ?? [])];
        newMessages = [...newHistory.splice(historyIndex, 1)[0].messages];
        setHistory(newHistory);
        setCache('history', newHistory);
        setMessages(newMessages);
        setCache('messages', newMessages);
      }

      // 先插入一条用户消息
      newMessages = [...newMessages, { role: Role.user, content }];
      setMessages(newMessages);
      setCache('messages', newMessages);
      setIsLoading(true);
      setHistoryIndex('current');
      await sleep(16);
      scrollToBottom();

      try {
        // stream 模式下，由前端组装消息
        let partialContent = '';
        // TODO 收到完整消息后，写入 cache 中
        const fullContent = await fetchApiChat({
          model: Model['gpt-3.5-turbo-0301'],
          messages: newMessages.map((message) => {
            return isMessage(message) ? message : message.choices[0].message;
          }),
          stream: true,
          onMessage: (content) => {
            // stream 模式下，由前端组装消息
            partialContent += content;
            setIsLoading(false);
            setMessages([...newMessages, { role: Role.assistant, content: partialContent }]);
            // 如果当前滚动位置距离最底端少于等于 72（即 3 行）并且当前用户没有正在滚动，则保持滚动到最底端
            if (gapToBottom() <= 72 && !getIsScrolling()) {
              scrollToBottom();
            }
          },
        });

        // 收到完整消息后，重新设置 messages
        newMessages = [...newMessages, { role: Role.assistant, content: fullContent }];
        setMessages(newMessages);
        setCache('messages', newMessages);
        // 如果当前滚动位置距离最底端少于等于 72（即 3 行）并且当前用户没有正在滚动，则保持滚动到最底端
        if (gapToBottom() <= 72 && !getIsScrolling()) {
          scrollToBottom();
        }
      } catch (e) {
        // 发生错误时，展示错误消息
        setIsLoading(false);
        setMessages([...newMessages, { isError: true, role: Role.assistant, content: (e as Error).message }]);
      }
    },
    [messages, history, historyIndex],
  );

  /**
   * 加载聊天记录
   */
  const loadHistory = useCallback(
    async (index: number) => {
      if (historyIndex === index) {
        return;
      }

      if (historyIndex === 'empty') {
        setHistoryIndex(index);
        setIsMenuShow(false);
        await sleep(16);
        scrollToBottom();
        return;
      }

      // 如果当前是在浏览历史，则直接切换 historyIndex
      if (typeof historyIndex === 'number') {
        setHistoryIndex(index);
        setIsMenuShow(false);
        await sleep(16);
        scrollToBottom();
        return;
      }

      // 如果当前有正在进行的聊天，则将正在进行的聊天归档到 history 中
      if (historyIndex === 'current') {
        const newHistory = [{ messages }, ...(history ?? [])];
        setHistory(newHistory);
        setCache('history', newHistory);
        setMessages([]);
        setCache('messages', []);
        setHistoryIndex(index);
        setIsMenuShow(false);
        await sleep(16);
        scrollToBottom();
      }
    },
    [setIsMenuShow, historyIndex, messages, history],
  );

  /** 删除单条聊天记录 */
  const deleteHistory = useCallback(
    async (deleteIndex: 'current' | number) => {
      // 如果删除的是还没有写入 history 的当前聊天，则直接删除 messages
      if (deleteIndex === 'current') {
        setMessages([]);
        setCache('messages', []);
        setHistoryIndex(history && history.length > 0 ? 0 : 'empty');
        return;
      }

      const newHistory = history?.filter((_, index) => index !== deleteIndex) ?? [];

      setHistory(newHistory);
      setCache('history', newHistory);

      // 选择最近的一条聊天记录展示
      setHistoryIndex(newHistory && newHistory.length > 0 ? Math.min(deleteIndex, newHistory.length - 1) : 'empty');
    },
    [history],
  );

  /** 开启新对话 */
  const startNewChat = useCallback(() => {
    let newHistory = [...(history ?? [])];
    if (messages.length > 0) {
      newHistory = [{ messages }, ...newHistory];
    }
    setHistory(newHistory);
    setCache('history', newHistory);
    setMessages([]);
    setCache('messages', []);
    setCurrentMenu(MenuKey.InboxStack);
    setHistoryIndex('empty');
  }, [messages, history, setCurrentMenu]);

  return (
    <ChatContext.Provider
      value={{
        sendMessage,
        isLoading,
        messages,
        history,
        historyIndex,
        loadHistory,
        deleteHistory,
        startNewChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
