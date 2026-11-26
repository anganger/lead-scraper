// Opens a visible Chrome so you sign in to LinkedIn yourself; the script never sees the password. The session stays in the profile folder.
import { openProfile, setLinkedInReady, PROFILE_DIR } from './linkedin';

async function main() {
  const ctx = await openProfile(false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://www.linkedin.com/login');
  console.log('Sign in to LinkedIn in the Chrome window. Waiting up to 10 minutes...');
  try {
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 10 * 60_000 });
    await page.waitForTimeout(3000);
    setLinkedInReady(true);
    console.log(`Signed in. Session saved in ${PROFILE_DIR}.`);
  } catch {
    console.error('Did not reach the LinkedIn feed in time. Run npm run linkedin:login again.');
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

main();
