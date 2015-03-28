# Easy2

## Requirements
* Node.JS of any recent vintage
* SSH keys stored in ``~/.ssh/`` and named after the AWS keypairs
* `~/.aws/config` file with credentials ([details](https://github.com/aws/aws-cli#getting-started))
  * For a good experience, include the region

## Installation and Updating
`npm install -g easy2`

## Usage
* `easy2 <instance filter>`
* `easy2 <instance filter>@<profile>`
* `easy2 -f <port to forward> <instance filter>`

If multiple instances match the filter, and they appear similar (based on Name), then one will be randomly chosen.

### Examples
* `easy2 http`
* `easy2 postgres@prod`
* `easy2 forward 8000 webserv@prod`
