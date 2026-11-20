// This script uses GitHub APIs only. It never executes incoming upstream code.
module.exports = async ({ github, context, core }) => {
  const owner = 'cromulus', repo = 'paperclip';
  if (context.repo.owner !== owner || context.repo.repo !== repo) throw new Error('Wrong fork');
  const branch = 'sync/upstream';
  const { data: upstream } = await github.rest.repos.getCommit({ owner: 'paperclipai', repo, ref: 'master' });
  const { data: comparison } = await github.rest.repos.compareCommits({ owner, repo, base: 'master', head: upstream.sha });
  if (!comparison.ahead_by) {
    core.info(`Fork includes upstream ${upstream.sha}; no update required.`);
    return;
  }
  const { data: base } = await github.rest.git.getRef({ owner, repo, ref: 'heads/master' });
  try {
    await github.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: base.object.sha });
  }
  // Preserve both fork changes and any prior sync commits. Conflicts fail visibly.
  await github.rest.repos.merge({ owner, repo, base: branch, head: base.object.sha });
  await github.rest.repos.merge({ owner, repo, base: branch, head: upstream.sha });
  const { data: prs } = await github.rest.pulls.list({ owner, repo, state: 'open', base: 'master', head: `${owner}:${branch}` });
  if (prs.length) { core.info(`Updated ${prs[0].html_url}`); return; }
  const body = `## Thinking Path
> - Paperclip manages agents and their tools.
> - This fork carries deployment changes.
> - Upstream fixes must remain available without replacing those changes.
> - This update merges upstream history into a review branch.
> - Production remains pinned until its own tests and rollout pass.

## Linked Issues or Issue Description
**What existing behavior does this improve?**
Keep the fork current with paperclipai/paperclip.

**Current behavior**
The fork is missing ${comparison.ahead_by} upstream commits as of this check.

**Proposed behavior**
Review and merge upstream commit ${upstream.sha}. Do not deploy automatically.

## What Changed
- Merge upstream master into the fork while preserving fork commits.
- Compare: https://github.com/${owner}/${repo}/compare/master...${branch}

## Verification
- GitHub accepted the merge without conflicts.
- Application tests have not run in this metadata-only workflow.
- Run affected tests and deployment checks before promotion to nmc/production.

## Risks
- Upstream changes can include migrations and runtime changes.
- This PR does not update the production image or grant credentials.

## Model Used
- None for this automated merge. The sync script was prepared with OpenAI Codex (GPT-6), with shell and code tools; exact runtime model variant and context size were not exposed.

## Checklist
- [x] I have included a thinking path that traces from project context to this change
- [x] I have specified the model used
- [x] This is fork maintenance, not a new core feature
- [x] I have described the issue above
- [x] I have not referenced internal instance issues
- [x] My branch name describes the change
- [ ] Applicable tests and CI pass for the final revision
- [ ] Deployment compatibility and migration safety have been reviewed
- [x] I have documented the risks
`;
  const { data: pr } = await github.rest.pulls.create({ owner, repo, base: 'master', head: branch,
    title: `Sync upstream Paperclip (${upstream.sha.slice(0, 12)})`, body, draft: true });
  core.info(`Created ${pr.html_url}`);
};
