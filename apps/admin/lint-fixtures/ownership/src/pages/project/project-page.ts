import { sharedPart } from "../../components/base/shared-part";
import { projectPart } from "../../components/project/project-part";
import { baseUtil } from "../../lib/base/base-util";
import { projectUtil } from "../../lib/project/project-util";

export const projectPage = [
  sharedPart,
  projectPart,
  baseUtil,
  projectUtil,
].join("/");
