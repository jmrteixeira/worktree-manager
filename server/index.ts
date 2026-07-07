import { createApp } from "./app";

const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const app = createApp();

app.listen(port, () => {
  console.log(`Worktree Manager API em http://localhost:${port}`);
});
