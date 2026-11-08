import { describe, expect, it } from 'vitest';
import { parseYouTubeId } from './youtube';

const ID = 'jfKfPfyJRdk';

describe('parseYouTubeId', () => {
  it('parses watch, youtu.be, live, embed and rejects other hosts and bad ids', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?feature=share&v=${ID}`,
      `http://www.youtube.com/watch?v=${ID}`,
      `youtube.com/watch?v=${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc123`,
      `https://www.youtube.com/live/${ID}`,
      `https://youtube.com/live/${ID}?feature=shared`,
      `https://www.youtube.com/embed/${ID}`,
      `https://m.youtube.com/embed/${ID}/`,
      `  https://www.youtube.com/watch?v=${ID}  `,
    ]) {
      expect(parseYouTubeId(url), url).toBe(ID);
    }

    for (const url of [
      `https://vimeo.com/watch?v=${ID}`,
      `https://www.youtube.com.evil.com/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `ftp://youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch?v=${ID}x`,
      `https://www.youtube.com/watch?v=bad!id$here`,
      `https://youtu.be/`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}/extra`,
      `https://www.youtube.com/watch`,
      `https://www.youtube.com/`,
      'not a url',
      '',
    ]) {
      expect(parseYouTubeId(url), url).toBeNull();
    }
  });
});
