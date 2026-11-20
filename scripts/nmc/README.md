# Fork maintenance

`master` tracks upstream with the NMC sync workflow added. The workflow checks
upstream daily at 11:17 UTC and on manual dispatch. It opens or updates one draft
PR on `sync/upstream`. It uses GitHub merge APIs and runs no upstream code. Merge
conflicts fail the job. Inspect failed Actions runs; silence is not a successful
sync. GitHub can suspend schedules in an inactive repository after 60 days.

`nmc/production` records the deployed release, selected upstream backports, and
its reproducible image overlay in `deploy/nmc`. Updating `master` does not deploy
or alter this branch. Promote an upstream release only after reviewing the NMC
overlay, database migrations, gateway regressions, and rollback compatibility.

For production backports, use `git cherry-pick -x` to preserve the upstream SHA.
Keep local-only fixes in separate commits with regression tests. Check upstream
first and retire a backport when the chosen release contains it. The historical
fork tip is preserved on `backup/master-20261120`.
