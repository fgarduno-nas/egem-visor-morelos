import { env } from "./config/env.js";
import { app } from "./app.js";

app.listen(env.PORT, () => {
  console.log(`${env.APP_NAME} escuchando en puerto ${env.PORT}`);
});
