#!/usr/bin/env node

// argv parsing
var queries = (process.argv[2] || '').split('@');
var filter = queries[0].toLowerCase();

if (queries[1] & queries[1].length) {
  process.env.AWS_PROFILE = queries[1];
}

// help
if (!filter.length) {
  console.error('No filter specified');
  console.info();
  console.info('Usage:');
  console.info('  sugar <instance filter>');
  console.info('  sugar <instance filter>@<profile>');
  console.info();
  console.info('Examples:');
  console.info('  sugar http');
  console.info('  sugar postgre@prod');
  process.exit(1);
}

// set up AWS
var fs = require('fs');
var aws = require('aws-sdk');
var ini = require('ini');

var config = ini.parse(fs.readFileSync(aws.config.credentials.filename, 'utf-8'));
var region = config[aws.config.credentials.profile].region;

if (!region) {
  region = 'us-east-1';
  console.warn('AWS job: Assuming', region, 'region');
}
aws.config.update({region: region});
var ec2 = new aws.EC2();

// fetch running instances
var opts = {
  Filters: [
    { Name: 'instance-state-name', Values: ['running'] },
  ],
};
ec2.describeInstances(opts, function (err, data) {
  if (err) {
    console.error('Error fetching instance list from ec2');
    console.error(err);
    process.exit(10);
  }

  // pull out names for instances, filter out irrelevant instances
  var instances = data.Reservations.map(function (res) {
    var instance = res.Instances[0];

    var nameTags = instance.Tags.filter(function (tag) {
      return tag.Key == 'Name';
    });

    if (nameTags.length) {
      instance.Name = nameTags[0].Value;
    }

    return instance;
  }).filter(function (instance) {
    // TODO: accept ami and instance IDs as well
    return instance.Name && instance.Name.toLowerCase().indexOf(filter) >= 0;
  });

  // handle multiple matches
  var instance;
  if (instances.length > 1) {
    var baseName = instances[0].Name;

    // if they differ from each other, complain
    instances.forEach(function (instance) {
      if (instance.Name != baseName) {
        console.error(filter, 'matches multiple different instances.');
        console.info('Matching instances:', instances.map(function (instance) {
          return instance.Name;
        }));
        process.exit(2);
      }
    });

    // pick a random instance
    var index = Math.floor(Math.random() * instances.length);
    instance = instances[index];

    console.info('Connecting to', instance.InstanceId,
                 '(one of', instances.length, baseName, 'instances)');

  // just once instance? cool
  } else if (instances.length) {
    instance = instances[0];

    console.info('Connecting to', instance.InstanceId,
                 '(the only', instance.Name, 'instance)');

  // complain if no matches
  } else {
    console.error('No instances match', filter);
    process.exit(3);
  }

  // hand over to SSH
  var dns = instance.PublicDnsName;
  var user = 'ubuntu'; // TODO
  var key = process.env.HOME + '/.ssh/titan'; // TODO

  // TODO: "killed: 9". is kexec even needed?
  //var kexec = require('kexec');
  //kexec('ssh', ['-i', key, [user, dns].join('@')]);

  var spawn = require('child_process').spawn;
  spawn('ssh', ['-i', key, [user, dns].join('@')], {stdio: [0, 1, 2]});
});
