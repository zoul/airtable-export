import Airtable from "airtable";
import axios from "axios";
import { Octokit } from "@octokit/rest";

//
// Airtable Support
//

interface AirtableConfig {
  apiKey: string;
  databaseId: string;
  tableName: string;
  lastModifiedField: string;
}

async function getLastAirtableModificationTime(
  table: Airtable.Table<{}>,
  lastModifiedField: string
): Promise<Date | null> {
  const query = table.select({
    fields: [lastModifiedField],
    sort: [{ field: lastModifiedField, direction: "desc" }],
    maxRecords: 1,
  });
  const matches = await query.all();
  const mostRecentRecord = matches[0];
  if (mostRecentRecord != null) {
    const stamp: string = (mostRecentRecord.fields as any)[lastModifiedField];
    return new Date(stamp);
  } else {
    return null;
  }
}

//
// GitHub Support
//

interface GitHubConfig {
  apiKey: string;
  user: string;
  repo: string;
  path: string;
  message: string;
}

async function getTargetFileSHA(config: GitHubConfig): Promise<string> {
  const url = `https://api.github.com/repos/${config.user}/${config.repo}/contents/${config.path}`;
  const response = await axios.get(url);
  return response.data["sha"];
}

//
// High-level Interface
//

async function exportAirtableDataToGitHub(
  airtableConfig: AirtableConfig,
  githubConfig: GitHubConfig,
  timeTreshold: number = 5 * 60
): Promise<void> {
  const airtable = new Airtable({ apiKey: airtableConfig.apiKey }).base(
    airtableConfig.databaseId
  );
  const table = airtable(airtableConfig.tableName);
  const lastUpdate = await getLastAirtableModificationTime(
    table,
    airtableConfig.lastModifiedField
  );
  if (lastUpdate != null) {
    const now = new Date();
    const timeSinceLastUpdate = (now.getTime() - lastUpdate.getTime()) / 1000;

    if (timeSinceLastUpdate < timeTreshold) {
      console.info(
        `Last update below update treshold (${timeTreshold} seconds), skipping update.`
      );
      return;
    }

    console.info(
      "Last update time over update treshold, will try to export data."
    );
    const matches = await table.select().all();
    const currentSHA = await getTargetFileSHA(githubConfig);
    const uploadData = toBase64(toJSON(matches.map((m) => m.fields)));
    const octokit = new Octokit({ auth: githubConfig.apiKey });

    await octokit.repos.createOrUpdateFileContents({
      owner: githubConfig.user,
      repo: githubConfig.repo,
      path: githubConfig.path,
      message: githubConfig.message,
      sha: currentSHA,
      content: uploadData,
    });
  } else {
    console.warn(
      "Unable to determine last table update time, no changes done."
    );
  }
}

//
// Utils
//

/** Convert data to a JSON string */
const toJSON = (data: any) => JSON.stringify(data, null, 2);

/** Convert data to a Base64 encoded string */
const toBase64 = (data: any) => Buffer.from(data).toString("base64");

function envOrDie(key: string): string {
  const val = process.env[key];
  if (val == null) {
    throw `Please define the ${key} env variable.`;
  }
  return val;
}

//
// Entry Point
//

async function main() {
  const airtableConfig: AirtableConfig = {
    apiKey: envOrDie("AIRTABLE_API_KEY"),
    databaseId: "apppZX1QC3fl1RTBM",
    tableName: "Web Export Test",
    lastModifiedField: "Last Update",
  };
  const githubConfig: GitHubConfig = {
    apiKey: envOrDie("GITHUB_API_TOKEN"),
    user: "zoul",
    repo: "airtable-export",
    path: "data.json",
    message: "Update data",
  };
  await exportAirtableDataToGitHub(airtableConfig, githubConfig);
}

main().catch((e) => console.error(e));
