import { createApp } from "./app";

const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const host = process.env.HOST ?? "127.0.0.1";
const app = createApp();

app.listen(port, host, () => {
  console.log(`Worktree Manager API em http://${host}:${port}`);
});
