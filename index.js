#!/usr/bin/env node

// argv parsing
var queries = (process.argv[2] || '').split('@');
var filter = queries[0].toLowerCase();
var profile = queries[1];

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
  console.info('  sugar postgres@prod');
  process.exit(1);
}

// resolve credentials and region
var fs = require('fs');
var ini = require('ini');
var aws = require('aws-sdk');

aws.config.update({region: process.env.AWS_REGION});

if (process.env.AWS_ACCESS_KEY_ID && !profile) {
  if (!process.env.AWS_REGION) {
    aws.config.update({region: 'us-east-1'});
    console.warn('AWS_REGION not present, assuming', aws.config.region);
  }

} else {
  var path = process.env.HOME + '/.aws/config';

  if (fs.existsSync(path)) {
    var config = ini.parse(fs.readFileSync(path, 'utf-8'));
    var creds = config[profile || 'default'];

    if (!creds) {
      var name = profile ? ('profile ' + profile) : 'profile';
      creds = config[name];
    }

    if (!creds) {
      console.error('Profile', profile || 'default', "couldn't be found in", path);
      process.exit(4);
    }
    aws.config.update({
      region: creds.region,
      accessKeyId: creds.aws_access_key_id,
      secretAccessKey: creds.aws_secret_access_key,
    });

  } else {
    console.warn('WARN: No AWS keys in environment and', path, "doesn't exist");
  }
}

// fetch running instances
var opts = {
  Filters: [
    { Name: 'instance-state-name', Values: ['running'] },
  ],
};

var ec2 = new aws.EC2();
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
    if (instance.Name && instance.Name.toLowerCase().indexOf(filter) >= 0) return true;
    if (instance.InstanceId == filter || instance.ImageId == filter) return true;
    return false;
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

  // find the private key
  var keyName = process.env.SSH_KEY || instance.KeyName || 'aws';
  var key = process.env.HOME + '/.ssh/' + keyName;

  if (!fs.existsSync(key)) {
    key += '.pem';

    if (!fs.existsSync(key)) {
      console.error('Private key', keyName, "isn't in ~/.ssh/");
      process.exit(5);
    }
  }

  // hand off to SSH
  var dns = instance.PublicDnsName;
  var user = process.env.SSH_USER || 'ubuntu'; // TODO

  // hand off to SSH
  var spawn = require('child_process').spawn;
  spawn('ssh', ['-i', key, [user, dns].join('@')], {stdio: [0, 1, 2]});
});
