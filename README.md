# Sugar SSH

## Requirements
* Node.JS of any recent vintage
* SSH keys stored in `~/.ssh/` and named after the AWS keypairs
* `~/.aws/config` file with credentials ([details](https://github.com/aws/aws-cli#getting-started))
  * For a good experience, include the region

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
* `sugar forward 8000 webserv@prod`
