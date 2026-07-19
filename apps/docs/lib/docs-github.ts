const REPO = "https://github.com/KitsuneKode/kunai";

export function docsEditUrl(path: string): string {
  return `${REPO}/edit/main/docs/${path}`;
}

export function docsViewUrl(path: string): string {
  return `${REPO}/blob/main/docs/${path}`;
}

export function docsGithubRepoUrl(): string {
  return REPO;
}

export function docsGithubIssuesUrl(): string {
  return `${REPO}/issues`;
}

export function docsGithubDiscussionsUrl(): string {
  return `${REPO}/discussions`;
}

export function docsGithubIssueTemplateUrl(
  template: "bug_report.yml" | "feature_request.yml" | "provider_issue.yml",
): string {
  return `${REPO}/issues/new?template=${template}`;
}
