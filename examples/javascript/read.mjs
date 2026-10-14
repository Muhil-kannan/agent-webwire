import { WebWire } from 'agent-webwire';

const pulse = new WebWire({ timeout: 15000, retries: 1 });
try {
  const page = await pulse.web.read('https://example.com');
  console.log(page.title, page.markdown);
} catch (error) {
  console.error(pulse.error(error));
  process.exitCode = 1;
}
