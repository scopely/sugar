# Sugar SSH

## Requirements
* Node.JS of any recent vintage
* SSH keys stored in ~/.ssh/ and named after the AWS keypairs

## Installation and Updating
`npm install -g sugar-ssh`

## Usage
* `sugar <instance filter>`
* `sugar <instance filter>@<profile>`
* `sugar -f <port to forward> <instance filter>`

Examples:

* `sugar http`
* `sugar postgres@prod`
* `sugar -f 8000 webserv@prod`

If multiple instances match the filter, and they appear similar (based on Name), then one will be randomly chosen.
