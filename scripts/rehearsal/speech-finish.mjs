/** Wait for the actual floor and durable speech state before a rehearsal helper may hard-navigate away. No network. */
export async function waitForSpeechFinish(page, readProjectedCheckpoint, speechId, {timeout = 15_000, every = 50} = {}) {
  await page.getByRole('heading', {name: 'The floor is with the Chair', exact: true}).waitFor({timeout});
  const end = Date.now() + timeout;
  for (;;) {
    const data = await readProjectedCheckpoint();
    if (data.speeches?.find(s => s.id === speechId)?.state === 'finished') return;
    if (Date.now() >= end) throw Error('The speech finish was not committed to the device checkpoint before navigation.');
    await new Promise(resolve => setTimeout(resolve, every));
  }
}
