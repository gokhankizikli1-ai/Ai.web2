import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message, AIMode, ChatFolder } from '@/types';
import { placeholderChats } from '@/data/placeholderChats';

const generateId = () => Math.random().toString(36).substring(2, 9);

const API_URL = 'https://worker-production-1345.up.railway.app/chat';
