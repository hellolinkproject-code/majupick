import { useEffect, useState } from 'react';

/** 입력이 delay(ms) 동안 멈춘 뒤의 값. 타이핑할 때마다 요청하지 않게 한다. */
export function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
