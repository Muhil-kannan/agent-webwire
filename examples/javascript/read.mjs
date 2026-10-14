import { WebPulse } from 'web-pulse';

const pulse = new WebPulse({ timeout: 15000, retries: 1 });
try {
  const page = await pulse.web.read('https://example.com');
  console.log(page.title, page.markdown);
} catch (error) {
  console.error(pulse.error(error));
  process.exitCode = 1;
}
