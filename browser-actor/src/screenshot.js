import { Actor, log } from 'apify';

let interval = null;

/**
 * Starts taking a screenshot every 5 seconds in the background.
 * Screenshots are saved to the Key-Value Store with timestamp keys.
 */
export function startScreenshots(page) {
  let counter = 0;
  interval = setInterval(async () => {
    try {
      counter++;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `screen-${ts}`;
      const buffer = await page.screenshot({ fullPage: false });
      await Actor.setValue(key, buffer, { contentType: 'image/png' });
    } catch {}
  }, 5000);
  log.info('[Screenshot] Started capturing every 5s');
}

/**
 * Stops the screenshot interval.
 */
export function stopScreenshots() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    log.info('[Screenshot] Stopped capturing');
  }
}
