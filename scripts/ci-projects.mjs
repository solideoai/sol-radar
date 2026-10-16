import { loadConfig, presentProjects } from "./project-config.mjs";
const root = process.cwd();
const projects = presentProjects(root, loadConfig(root)).map(({ name, directory }) => ({
  name,
  directory,
}));
console.log(`projects=${JSON.stringify(projects)}`);
console.log(`has-projects=${projects.length > 0}`);
