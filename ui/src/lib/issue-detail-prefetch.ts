export function loadIssueDetailPage() {
  return import("../pages/IssueDetail").then((module) => ({ default: module.IssueDetail }));
}
