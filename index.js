#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));
if (argv.version) {
  var package = require('./package');
  console.log(package.name, package.version);
  console.log(package.homepage);
  process.exit();
}

function debug () {
  if (argv.v) {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['sugar:'].concat(args));
  }
}

var queries = (argv._[0] || '').split('@');
var filter = queries[0].toLowerCase();
var profile = queries[1];

// help
if (!filter.length || argv.help) {
  if (!argv.help) {
    console.error('No filter specified');
    console.info();
  }

  console.info('Usage:');
  console.info('  sugar <instance filter>');
  console.info('  sugar <instance filter>@<profile>');
  console.info('  sugar -f <port to forward> <instance filter>');
  console.info();
  console.info('Examples:');
  console.info('  sugar http');
  console.info('  sugar postgres@prod');
  console.info('  sugar -f 8000 webserv@prod');

  process.exit(argv.help ? 0 : 1);
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
    if (instance.PublicDnsName == filter || instance.PublicIpAddress == filter) return true;
    if (instance.PrivateDnsName == filter || instance.PrivateIpAddress == filter) return true;
    return false;
  });

  // handle multiple matches
  var instance, flair, forceList;
  if (instances.length > 1) {
    var baseName = instances[0].Name;

    // if they differ from each other, complain
    instances.forEach(function (instance) {
      if (instance.Name != baseName && !forceList) {
        console.error(filter, 'matches multiple different instances.');
        forceList = true;
      }
    });

    // pick a random instance
    var index = Math.floor(Math.random() * instances.length);
    instance = instances[index];
    flair = ['(one of', instances.length, baseName, 'instances)'].join(' ');

  // just once instance? cool
  } else if (instances.length) {
    instance = instances[0];
    flair = ['(the only', instance.Name, 'instance)'].join(' ');

  } else {
    console.error('No instances match', filter);
    process.exit(3);
  }
  debug('Decided on', instance.InstanceId);

  // handle user output demands
  if (argv.dns) { // print DNS and bail
    console.log(instance.PublicDnsName || instance.PublicIpAddress);
    process.exit();

  } else if (argv.list || forceList) { // show a basic list
    instances.forEach(function (instance) {
      console.log([instance.InstanceId, instance.Name, instance.PublicDnsName || instance.PublicIpAddress].join('\t'));
    });
    process.exit(forceList ? 2 : 0);
  }

  var sshInfo;
  instance.Tags.forEach(function (keyval) {
    if (keyval.Key == 'SshInfo')
      sshInfo = JSON.parse(keyval.Value);
  });

  if (sshInfo) { // && sshInfo.prints && sshInfo.prints.ecdsa) {
    connect(instance, sshInfo, flair);
  } else {
    debug('Finding instance SSH info...');

    var params = { InstanceId: instance.InstanceId };
    ec2.getConsoleOutput(params, function (err, data) {
      if (err) {
        console.error('sugar: Error fetching EC2 console output:', err);
        connect(instance, null, flair);
      } else {
        var output = new Buffer(data.Output, 'base64').toString();
        sshInfo = { prints: {} };

        if (output.indexOf('Amazon') > -1) {
          sshInfo.username = 'ec2-user';
        } else if (output.indexOf('Ubuntu') > -1) {
          sshInfo.username = 'ubuntu';
        } else if (output.indexOf('Microsoft Windows') > -1) {
          sshInfo.username = 'Administrator';
        } else {
          console.warn('sugar: Unable to fingerprint instance type/username');
        }

        var regex = /Your public key has been saved in \/etc\/ssh\/ssh_host_([^_]+)_key\.pub\.[\r\n]+The key fingerprint is:[\r\n]+([0-9a-f:]+) /g;
        var match;
        while ((match = regex.exec(output)) !== null) {
          sshInfo.prints[match[1]] = match[2];
        }

        if (!Object.keys(sshInfo.prints).length) {
          console.warn('sugar: No SSH host keys found in instance log.');
          delete sshInfo.prints;
        }

        debug('sugar: Storing SSH info', sshInfo);
        ec2.createTags({
          Resources: [instance.InstanceId],
          Tags: [{
            Key: 'SshInfo',
            Value: JSON.stringify(sshInfo),
          }],
        }, function (err, data) {
          if (err)
            console.error('sugar ERR: createTags ->', err);
        });

        connect(instance, sshInfo, flair);
      }
    });
  }
});

function verifyHostKey (host, prints, cb) {
  var fs = require('fs');
  var path = process.env.HOME + '/.ssh/known_hosts';

  debug('Reading known_hosts file');
  var known = fs.readFileSync(path, 'utf-8');
  if (known.indexOf(host[0]) > -1) {
    debug('Host key already added');
    cb();

  } else {
    console.info('sugar: Getting host key from', host);

    var execFile = require('child_process').execFile;
    var fingerprint = require('ssh-fingerprint');

    execFile('ssh-keyscan', [host[0]], function (err, sout, serr) {
      if (err) {
        console.warn('sugar: Error running ssh-keyscan:', err);
        return cb();
      }

      var nl = known[known.length - 1] == '\n' ? '' : '\n';
      var map = {
        'ecdsa-sha2-nistp256': 'ecdsa',
        'ssh-rsa': 'rsa',
        'ssh-dsa': 'dsa',
      };
      sout.toString().split('\n').forEach(function (line) {
        var parts = line.split(' ');
        if (parts.length < 3) return;
        var print = fingerprint(parts[2]);

        if (print == prints[map[parts[1]]]) {
          parts[0] = host.join(',');
          fs.appendFileSync(path, nl + parts.join(' ') + '\n');
          nl = '';
        } else {
          console.warn('sugar: !WARN! Host', parts[1], 'key has changed');
        }
      });

      cb();
    });
  }
}

function connect (instance, sshInfo, flair) {
  // find the private key
  var keyName = argv.key || process.env.SSH_KEY || instance.KeyName || 'aws';
  var key = process.env.HOME + '/.ssh/' + keyName;

  if (!fs.existsSync(key)) {
    key += '.pem';

    if (!fs.existsSync(key)) {
      console.error('Private key', keyName, "isn't in ~/.ssh/");
      process.exit(5);
    }
  }

  // prepare SSH arguments
  var sshFlags = [];
  sshFlags.push('-i');
  sshFlags.push(key);

  if (argv.f) {
    var port = +argv.f;
    sshFlags.push('-L');
    sshFlags.push(port + ':localhost:' + port);
  }

  if (argv.v) {
    sshFlags.push('-v');
  }

  var user = argv.user || process.env.SSH_USER || sshInfo.username || 'ubuntu';
  var host = instance.PublicDnsName || instance.PublicIpAddress;
  sshFlags.push([user, host].join('@'));

  if (sshInfo && sshInfo.prints) {
    verifyHostKey([host, instance.PublicIpAddress], sshInfo.prints, function () {
      finalize(instance, flair, sshFlags);
    });
  } else {
    finalize(instance, flair, sshFlags);
  }
}

function finalize (instance, flair, sshFlags) {
  // check if user just wants options for `ssh`
  if (argv['ssh-opts']) {
    console.log(sshFlags.join(' '));
    process.exit();
  }

  // hand off to SSH
  console.info('Connecting to', instance.InstanceId, flair);
  var spawn = require('child_process').spawn;
  spawn('ssh', sshFlags, {stdio: [0, 1, 2]});
}
