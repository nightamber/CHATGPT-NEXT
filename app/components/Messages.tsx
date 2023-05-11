'use client';

import { useContext, useEffect } from 'react';

import { ChatContext } from '@/context/ChatContext';
import { Role } from '@/utils/constants';
// import { exampleMessages } from '@/utils/exampleMessages';
import { initEventListenerScroll } from '@/utils/scroll';

import { Message, SystemMessage } from './Message';

const SYSTEM_MESSAGE = (
  <>
    This page will send data to OpenAI.
    <br />
    Please be aware of the privacy risks, and refrain from sending any illegal content.
  </>
);
const WELCOME_MESSAGE = 'Hello! How can I assist you?';
const LOADING_MESSAGE = 'thinking.....';

export const Messages = () => {
  let { isLoading, messages, history, historyIndex, startNewChat } = useContext(ChatContext)!;

  // 初始化滚动事件
  useEffect(initEventListenerScroll, []);

  // 如果当前在浏览聊天记录，则展示该聊天记录的 messages
  if (history && typeof historyIndex === 'number') {
    messages = history[historyIndex].messages;
  }

  // messages = exampleMessages;

  return (
    <div className="md:grow" style={{ display: 'flow-root' }}>
      <SystemMessage>{SYSTEM_MESSAGE}</SystemMessage>
      <Message role={Role.assistant} content={WELCOME_MESSAGE} />
      {messages.map((message, index) => (
        <Message key={index} {...message} />
      ))}
      {isLoading && <Message role={Role.assistant} content={LOADING_MESSAGE} />}
      {messages.length > 1 && (
        <SystemMessage>
          连续对话会加倍消耗 tokens，
          <a className="text-gray-link" onClick={startNewChat}>
            开启新对话
          </a>
        </SystemMessage>
      )}
    </div>
  );
};
