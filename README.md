# Sugar SSH

## Requirements
* Node.JS of any recent vintage
* SSH keys stored in ``~/.ssh/`` and named after the AWS keypairs
* `~/.aws/config` file with credentials ([details](https://github.com/aws/aws-cli#getting-started))
  * For a good experiance, include the region

## Installation and Updating
`npm install -g sugar-ssh`

## Usage
* `sugar <instance filter>`
* `sugar <instance filter>@<profile>`
* `sugar -f <port to forward> <instance filter>`

If multiple instances match the filter, and they appear similar (based on Name), then one will be randomly chosen.

### Examples
* `sugar http`
* `sugar postgres@prod`
* `sugar -f 8000 webserv@prod`

### Flags
* `--help` displays help and exits
* `--dns` prints only the DNS hostname of the target instance, then exits. Suitable for shell substitution
* `--list` prints a table of all matching instances
* `--user <username>` forces the username used for the server
  * Default: `ubuntu`
* `--key <keyname>` overrides the key name for the instance
  * Specified keys will still be resolved using `~/.ssh/`
* `-f <port>` brings the remote instance's specified port to your local machine using an SSH tunnel
* `--ssh-opts` prints only the full arguments list for `ssh`
  * Example: `-i /home/user/.ssh/aws ubuntu@ec2-w-x-y-z.compute-1.amazonaws.com`
  * Useful for embedding in custom `ssh` or `scp` calls
