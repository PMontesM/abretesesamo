import { application } from "./application.js";
export const getPlatformAdminHTML = (user) =>
  application({ mode: "platform", user: { username: user.username } });
