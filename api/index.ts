import serverless from "serverless-http";
import { app } from "../server";

const handler = serverless(app);

export default async function (req: any, res: any) {
  return handler(req, res);
}

