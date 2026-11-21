/** Same-bot checks (#142): with no other bot eligible, a fresh hidden session of the owner checks, on the review model when it differs. */
export const WORK_CHECK_COLUMNS = `ALTER TABLE work_checks ADD COLUMN same_bot INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE work_checks ADD COLUMN checker_model TEXT;`
