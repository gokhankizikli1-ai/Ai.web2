import { useState, useEffect, useRef } from 'react';

export function useStreamingText(fullText: string, speed: number = 15, enabled: boolean = true) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDisplayedText(fullText);
      setIsComplete(true);
      return;
    }

    setDisplayedText('');
    setIsComplete(false);
    indexRef.current = 0;

    const streamChar = () => {
      const currentIndex = indexRef.current;
      if (currentIndex >= fullText.length) {
        setIsComplete(true);
        return;
      }

      // Determine delay based on character type for natural feel
      let delay = speed;
      const char = fullText[currentIndex];
      const prevChar = fullText[currentIndex - 1];

      // Pause after sentences
      if (char === '.' || char === '!' || char === '?') {
        delay = speed * 6;
      }
      // Pause after commas and semicolons
      else if (char === ',' || char === ';') {
        delay = speed * 3;
      }
      // Slight pause on newlines
      else if (char === '\n') {
        delay = speed * 4;
      }
      // Pause after code blocks
      else if (prevChar === '`' && char === '`') {
        delay = speed * 2;
      }
      // Normal variance for organic feel
      else {
        delay = speed + Math.random() * speed * 0.5;
      }

      // Batch characters for smoother rendering (render 1-3 chars at a time)
      const batchSize = Math.floor(Math.random() * 2) + 1;
      const nextIndex = Math.min(currentIndex + batchSize, fullText.length);
      indexRef.current = nextIndex;
      setDisplayedText(fullText.slice(0, nextIndex));

      timerRef.current = setTimeout(streamChar, delay);
    };

    // Start streaming after a small initial delay
    timerRef.current = setTimeout(streamChar, 100);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fullText, speed, enabled]);

  return { displayedText, isComplete };
}
