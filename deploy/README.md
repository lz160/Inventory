# Hetzner SQL Server

The pinned Microsoft SQL Server 2025 Express container listens on loopback port 11433. Persistent SQL files live on a separate LUKS2 volume. The application verifies the private CA at `/etc/receiving-sql/ca.pem` and uses database-specific logins.

## Initial setup

1. As root, install the two `.sh` files in `/usr/local/lib/receiving-sql` and the systemd units in `/etc/systemd/system`. Run `systemctl daemon-reload`.
2. Generate a binary 32-byte random key with `openssl rand -out luks.key 32`. Keep it with off-server recovery materials and supply it to `receiving-sql.sh create` through stdin over SSH.
3. Run `receiving-sql.sh prepare` and `systemctl start receiving-sql`. Use `receiving-sql.sh sqlcmd -Q "SELECT SERVERPROPERTY('Edition');"` to verify the installation.
4. Use a backup recipient X.509 certificate with an RSA public key and key encipherment usage. Install the public certificate at `/etc/receiving-sql/backup-recipient.pem` and keep its private key off-server. After provisioning the databases, start `receiving-sql-backup.service` for an initial backup and enable `receiving-sql-backup.timer` for daily runs. Copy encrypted backup files from `/var/backups/receiving-sql` to separate backup storage.

The initial 3 GiB volume holds the databases and transient backup files. Check disk and memory usage when adding stores or importing large datasets. The container has a 2.25 GiB memory limit and startup requires 2.4 GiB of available host RAM.

## Unlock after host reboot

Pipe the off-server binary key over SSH to `/usr/local/lib/receiving-sql/receiving-sql.sh unlock`. Start `receiving-sql` and `receiving-workbench` and verify that both are active. If the backup timer fired while the volume was locked, start the backup service again after SQL Server is available.

For the current deployment, the key is in the Mac workspace's `.receiving-sql-recovery` directory next to `Inventory`. Run from the `Inventory` directory on that Mac.

```bash
ssh -T -i ~/Desktop/id_ed25519_hetzner -p 2222 root@95.216.191.114 \
    '/usr/local/lib/receiving-sql/receiving-sql.sh unlock &&
    systemctl start receiving-sql receiving-workbench &&
    systemctl is-active receiving-sql receiving-workbench' \
    < ../.receiving-sql-recovery/luks.key
```

Keep the volume key and backup private key in a recoverable location that is independent of this VM. The root-owned `/srv/receiving-sql/app.env` is protected by the mounted volume and is backed up as a separate encrypted file.

## Test a restore

Run OpenSSL on an off-server machine that holds the recovery key. Supply the archive path, certificate, key, and SSH destination. Stream the decrypted backup to a file under `/srv/receiving-sql/sql/backup` where container UID 10001 can read it.

```bash
set -o pipefail
openssl cms -decrypt -binary -inform DER -in "$backup_archive" \
    -recip "$backup_cert" -inkey "$backup_private_key" |
    ssh -T "$receiving_host" 'mountpoint -q /srv/receiving-sql && umask 077 &&
    backup=/srv/receiving-sql/sql/backup/op-restore-test.bak &&
    (set -C; cat > "$backup") && chown 10001:0 "$backup"'
```

Continue after the pipeline reports success. Use `receiving-sql.sh sqlcmd` to run `RESTORE FILELISTONLY` and `RESTORE VERIFYONLY` with `CHECKSUM` against `/var/opt/mssql/backup/op-restore-test.bak`. Restore into a new database name using `MOVE` for both logical files to unique paths under `/var/opt/mssql/data`. Run `DBCC CHECKDB` and inspect expected rows. Then remove the restore-test database and its staged backup. A replacement instance also needs the matching application configuration. Recreate database logins and remap the restored users to their logins before starting the app.

## References

- [SQL Server 2025 editions on Linux](https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-editions-and-components-2025)
- [Configure TLS on SQL Server for Linux](https://learn.microsoft.com/en-us/sql/linux/security/encrypted-connections)
