import { convertApi } from "../services/convertAPI";

export async function handleMessage(message: any, webview: any) {
  try {
    switch (message.command) {
      case "getProjects":
        console.log("GETTING PROJECTS WITH ACCOUNT ID:", message.accountId);
        const projects = await convertApi.getProjects(
          message.apiKey,
          message.accountId,
        );
        webview.postMessage({ command: "projects", data: projects });
        break;

      case "getExperiences":
        console.log(
          "GETTING EXPERIENCES WITH ACCOUNT ID:",
          message.accountId,
          "AND PROJECT ID:",
          message.projectId,
          "AND API KEY:",
          message.apiKey,
        );
        const experiences = await convertApi.getExperiences(
          message.apiKey,
          message.accountId,
          message.projectId,
        );
        webview.postMessage({ command: "experiences", data: experiences });
        break;

      case "getVariations":
        console.log(
          "GETTING VARIATIONS WITH ACCOUNT ID:",
          message.accountId,
          "AND EXPERIENCE ID:",
          message.experienceId,
          "AND PROJECT ID:",
          message.projectId,
          "AND API KEY:",
          message.apiKey,
        );
        const variations = await convertApi.getVariations(
          message.apiKey,
          message.accountId,
          message.projectId,
          message.experienceId,
        );

        

        const variations_data =
          (variations as any)?.variations?.map((v: any) => ({
            id: v.id,
            name: v.name
          })) || [];


        webview.postMessage({
          command: "variations",
          data: variations_data,
        });

        break;
    }
  } catch (err: any) {
    webview.postMessage({
      command: "error",
      message: err.message,
    });
  }
}
