import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Load application config to get the correct data_root path
function resolveDataRoot() {
  const projectRoot = process.cwd();
  
  // Respect environment overrides first
  if (process.env.TRAINER_DATA_ROOT) {
    return path.resolve(projectRoot, process.env.TRAINER_DATA_ROOT);
  }
  
  // Try to load config.json
  try {
    const configPath = path.join(projectRoot, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.data_root) {
        return path.resolve(projectRoot, config.data_root);
      }
    }
  } catch (err) {
    console.error('[db_helper] Failed to read config.json, falling back to "data":', err);
  }
  
  return path.join(projectRoot, 'data');
}

/**
 * Find user_id by their display name inside the filesystem database.
 * @param {string} userName Display name of the user.
 * @returns {string|null} The user_id if found, otherwise null.
 */
export function findUserIdByName(userName) {
  const dataRoot = resolveDataRoot();
  const usersDir = path.join(dataRoot, 'users');
  
  if (!fs.existsSync(usersDir)) {
    return null;
  }
  
  const dirs = fs.readdirSync(usersDir);
  for (const dirName of dirs) {
    const profilePath = path.join(usersDir, dirName, 'profile.json');
    if (fs.existsSync(profilePath)) {
      try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        if (profile.profile && profile.profile.name === userName) {
          return profile.user_id || dirName;
        }
      } catch (err) {
        // Skip unreadable profile files
      }
    }
  }
  
  return null;
}

/**
 * Deletes a user by display name using the clean_user.py Python helper.
 * This directly cleans up PostgreSQL, MinIO, and local files bypassing authentication requirements.
 * @param {string} baseURL The base URL of the running Flask app.
 * @param {string} userName Display name of the user to delete.
 * @param {string} [verificationPassword] Password if one was set.
 * @returns {Promise<boolean>} True if cleanup script succeeded.
 */
export async function cleanUserByName(baseURL, userName, verificationPassword = '') {
  console.log(`[db_helper] Invoking clean_user.py to wipe user "${userName}"...`);
  
  try {
    const projectRoot = process.cwd();
    const pythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    const scriptPath = path.join(projectRoot, 'tests', 'audit_suite', 'helpers', 'clean_user.py');
    const email = `${userName.toLowerCase()}@localhost.test`;
    
    const output = execSync(`"${pythonPath}" "${scriptPath}" "${userName}" "${email}"`, { encoding: 'utf-8' });
    console.log(`[db_helper] clean_user.py output:\n${output.trim()}`);
    return true;
  } catch (err) {
    console.error(`[db_helper] Failed to execute clean_user.py:`, err.message);
    
    // Fallback direct filesystem delete
    const userId = findUserIdByName(userName);
    if (userId) {
      return forceDeleteUserDir(userId);
    }
    return false;
  }
}

/**
 * Fallback direct filesystem folder deletion if python script fails.
 */
function forceDeleteUserDir(userId) {
  const dataRoot = resolveDataRoot();
  const userDir = path.join(dataRoot, 'users', userId);
  
  if (fs.existsSync(userDir)) {
    try {
      fs.rmSync(userDir, { recursive: true, force: true });
      console.log(`[db_helper] Force-deleted user directory on filesystem: ${userDir}`);
      return true;
    } catch (err) {
      console.error(`[db_helper] Failed to force-delete user directory:`, err);
    }
  }
  return false;
}

/**
 * Polls the local Mailpit REST API to find the latest email sent to a recipient,
 * parses its content, and extracts a link matching the given pattern.
 * @param {string} mailpitURL Base URL of the Mailpit dashboard (e.g. 'http://localhost:8025').
 * @param {string} recipientEmail Email address of the recipient.
 * @param {RegExp} linkPattern RegExp to match the link URL.
 * @param {number} timeoutMs Maximum time to wait for the email to arrive (default 8000ms).
 * @returns {Promise<string>} The extracted URL string.
 */
export async function fetchLastEmailLink(mailpitURL, recipientEmail, linkPattern, timeoutMs = 8000) {
  const cleanEmail = recipientEmail.toLowerCase().trim();
  const startTime = Date.now();
  
  console.log(`[db_helper] Waiting for email to "${cleanEmail}"...`);
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const listResponse = await fetch(`${mailpitURL}/api/v1/messages`);
      if (!listResponse.ok) {
        throw new Error(`Mailpit list returned HTTP ${listResponse.status}`);
      }
      
      const listData = await listResponse.json();
      const messages = listData.messages || [];
      
      const matchMsg = messages.find(msg => 
        msg.To && msg.To.some(to => to.Address.toLowerCase().trim() === cleanEmail)
      );
      
      if (matchMsg) {
        const msgResponse = await fetch(`${mailpitURL}/api/v1/message/${matchMsg.ID}`);
        if (msgResponse.ok) {
          const msgData = await msgResponse.json();
          const bodyContent = msgData.HTML || msgData.Text || '';
          
          const match = bodyContent.match(linkPattern);
          if (match && match[1]) {
            const rawUrl = match[1].replace(/&amp;/g, '&');
            console.log(`[db_helper] Successfully extracted link: ${rawUrl}`);
            return rawUrl;
          }
        }
      }
    } catch (err) {
      console.warn(`[db_helper] Mailpit polling warning:`, err.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(`Timeout waiting for email verification/reset link to "${recipientEmail}" in Mailpit at ${mailpitURL}`);
}
