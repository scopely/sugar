import nomnom from "nomnom";
import fs from "fs";
import ini from "ini";
import AWS from "aws-sdk";
import fingerprint from "ssh-fingerprint";
import {execFile, spawn} from "child_process";

let DEBUG = false;
let opts = nomnom().script('easy2');

opts.command('dns')
  .callback(dns)
  .option('filter', {
    position: 1,
    required: true,
    help: "Filter to match against – postgres@prod"
  })
  .help("Print DNS and bail.");

opts.command('list')
  .callback(list)
  .help("List matching instances.");

function addCommonSSHOpts(cmd) {
  return cmd
    .option('filter', {
      position: 1,
      required: true,
      help: "Filter to match against – postgres@prod"
    })
    .option('verbose', {
      abbr: 'v',
      callback: () => DEBUG = true,
      flag: true,
      help: "Pass this flag to display debug output."
    })
    .option('key', {
      abbr: 'k',
      help: "Key name for the instance."
    })
    .option('identity', {
      abbr: 'i',
      help: "Force path to key file."
    })
    .option('user', {
      abbr: 'u',
      default: 'ubuntu',
      help: "Log in as this user."
    })
    .option('opts', {
      abbr: 'o',
      flag: true,
      help: "Just print the ssh options that would've been used."
    });
}

addCommonSSHOpts(
  opts.command('forward')
    .callback(connect)
    .option('port', {
      position: 2,
      required: true,
      help: "Port to forward."
    })
    .help("Port forward on a port to the matching instance.")
);

addCommonSSHOpts(
  opts.command('ssh')
    .callback(connect)
    .help("Connect to a matching instance via ssh.")
);

function debug(...args) {
  if (DEBUG) {
    console.log.apply(console, ['sugar:'].concat(args));
  }
}

AWS.config.update({region: process.env.AWS_REGION});

function parseMatch(filter) {
  let queries = (filter || '').split('@');
  return {
    queries: queries,
    filter: queries[0].toLowerCase(),
    profile: queries[1]
  };
}

function setConfig(profile) {
  if (process.env.AWS_ACCESS_KEY_ID && !profile) {
    AWS.config.update({region: 'us-east-1'});
    console.warn('AWS_REGION not present, assuming', AWS.config.region);
  } else {
    let path = process.env.HOME + '/.aws/config';
    if (fs.existsSync(path)) {
      let config = ini.parse(fs.readFileSync(path, 'utf-8'));
      let creds = config[profile || 'default'];

      if (!creds) {
        creds = config[profile ? `profile ${profile}` : 'profile'];
        if (!creds) {
          console.error(`Profile ${profile || 'default'} not found in ${path}`);
          process.exit(4);
        }
      }

      AWS.config.update({
        region: creds.region,
        accessKeyId: creds.aws_access_key_id,
        secretAccessKey: creds.aws_secret_access_key
      });
    } else {
      console.warn(`WARN: No keys in environment and ${path} doesn't exist`);
      process.exit(4);
    }
  }
}

function makeEC2(profile) {
  setConfig(profile);
  return new AWS.EC2();
}

function isMatch(filter, inst) {
  return (inst.Name && inst.Name.toLowerCase().indexOf(filter) >= 0) ||
         (inst.InstanceId === filter || inst.ImageId === filter) ||
         (inst.PublicDnsName === filter || inst.PublicIpAddress === filter) ||
         (inst.PrivateDnsName === filter || inst.PrivateIpAddress === filter);
}

function filterInstances(filter, data) {
  return data.Reservations.map(res => {
    let instance = res.Instances[0];
    let nameTag = instance.Tags.find(tag => tag.Key === 'Name');

    if (nameTag) {
      instance.Name = nameTag.Value;
    }

    return instance;
  }).filter(instance => isMatch(filter, instance));
}

function getInstances(ec2) {
  let params = {
    Filters: [
      { Name: 'instance-state-name', Values: ['running'] }
    ]
  };

  return new Promise(resolve => {
    ec2.describeInstances(params, (err, data) => {
      if (err) {
        console.error('Error fetching instance list from ec2');
        console.error(err);
        process.exit(10);
      }

      resolve(data);
    });
  });
}

function listInstances(instances) {
  instances.forEach(function (instance) {
    console.log([
      instance.InstanceId,
      instance.Name,
      instance.PublicDnsName || instance.PublicIpAddress
    ].join('\t'));
  });
}

function selectInstance(filter, instances) {
  let instance;

  if (instances.length > 1) {
    let baseName = instances[0].Name;

    if (instances.some(instance => instance.Name !== baseName)) {
      console.error(filter, 'matches multiple different instances.');
      listInstances(instances);
    }

    // pick a random instance
    var index = Math.floor(Math.random() * instances.length);
    instance = instances[index];

  } else if (instances.length) {
    instance = instances[0];
  } else {
    console.error('No instances match', filter);
    process.exit(3);
  }

  debug(`Decided on ${JSON.stringify(instance)}`);
  return instance;
}

function getPrivateKey(args, instance) {
  let key, keyName;
  if (args.identity) {
    key = args.identity;
  } else {
    keyName = args.key || process.env.SSH_KEY || instance.KeyName || 'aws';
    key = process.env.HOME + '/.ssh/' + keyName;
  }

  if (!fs.existsSync(key)) {
    let pem = key + '.pem';

    if (!fs.existsSync(pem)) {
      if (args.identity) {
        console.error(`Cannot find key at ${key}`);
      } else {
        console.error(`Private key ${keyName} isn't in ~/.ssh/`);
      }

      process.exit(5);
    } else {
      key = pem;
    }
  }

  return key;
}

function buildSSHInfo(ec2, instance) {
  let sshInfo = instance.Tags.find(tag => tag.Name === 'SshInfo');

  if (sshInfo) {
    return JSON.parse(sshInfo);
  } else {
    debug('Finding instance SSH info...');
    return new Promise(resolve => {
      ec2.getConsoleOutput({InstanceId: instance.InstanceId}, (err, data) => {
        if (err) {
          console.error('sugar: Error fetching EC2 console output:', err);
          resolve();
        }

        let output = new Buffer(data.Output, 'base64').toString();

        let regex = /Your public key has been saved in \/etc\/ssh\/ssh_host_([^_]+)_key\.pub\.[\r\n]+The key fingerprint is:[\r\n]+([0-9a-f:]+) /g;
        let sshInfo = { prints: {} };
        let match;

        while ((match = regex.exec(output)) !== null) {
          sshInfo.prints[match[1]] = match[2];
        }

        if (output.indexOf('Amazon') > -1) {
          sshInfo.username = 'ec2-user';
        } else if (output.indexOf('Ubuntu') > -1) {
          sshInfo.username = 'ubuntu';
        } else if (output.indexOf('Microsoft Windows') > -1) {
          sshInfo.username = 'Administrator';
        } else {
          console.warn('sugar: Unable to fingerprint instance type/username');
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
            Value: JSON.stringify(sshInfo)
          }]
        }, err => {
          if (err) {
            console.error('sugar ERR: createTags ->', err);
          }

          resolve(instance, sshInfo);
        });
      });
    });
  }
}

function getConnectInfo(instance, args, sshInfo) {
  return {
    user: args.user || process.env.SSH_USER || sshInfo.username || 'ubuntu',
    host: instance.PublicDnsName || instance.PublicIpAddress
  };
}

function verifyHostKey(host, prints) {
  let path = process.env.HOME + '/.ssh/known_hosts';

  debug('Reading known_hosts file');
  let known = fs.readFileSync(path, 'utf-8');

  if (known.indexOf(host[0]) > -1) {
    debug('Host key already added');
  } else {
    console.info('sugar: Getting host key from', host);
    return new Promise(resolve => {
      execFile('ssh-keyscan', [host[0]], function (err, sout) {
        if (err) {
          console.warn('sugar: Error running ssh-keyscan:', err);
          resolve();
        }

        let nl = known[known.length - 1] === '\n' ? '' : '\n';
        let map = {
          'ecdsa-sha2-nistp256': 'ecdsa',
          'ssh-rsa': 'rsa',
          'ssh-dsa': 'dsa'
        };
        sout.toString().split('\n').forEach(function (line) {
          var parts = line.split(' ');
          if (parts.length < 3) return;
          var print = fingerprint(parts[2]);

          if (print === prints[map[parts[1]]]) {
            parts[0] = host.join(',');
            fs.appendFileSync(path, nl + parts.join(' ') + '\n');
          } else {
            console.warn('sugar: !WARN! Host', parts[1], 'key has changed');
          }
        });

        resolve();
      });
    });
  }
}

function dns(dnsOpts) {
  let match = parseMatch(dnsOpts.filter);
  let ec2 = makeEC2(match.profile);
  let filter = match.filter;

  getInstances(ec2)
    .then(instances => filterInstances(filter, instances))
    .then(instances => selectInstance(filter, instances))
    .then(instance => {
      console.log(instance.PublicDnsName || instance.PublicIpAddress);
      process.exit();
    });
}

function list(listOpts) {
  let match = parseMatch(listOpts[1]);
  let ec2 = makeEC2(match.profile);

  getInstances(ec2)
    .then(instances => filterInstances(match.filter, instances))
    .then(listInstances);
}

function connect(cmdOpts) {
  let match = parseMatch(cmdOpts.filter);
  let ec2 = makeEC2(match.profile);
  let filter = match.filter;

  getInstances(ec2)
    .then(instances => filterInstances(filter, instances))
    .then(instances => selectInstance(filter, instances))
    .then(instance => buildSSHInfo(ec2, instance))
    .then((instance, sshInfo) => {
      let key = getPrivateKey(cmdOpts, instance);

      let sshOpts = [];
      sshOpts.push('-i', key);

      if (cmdOpts.port) {
        sshOpts.push('-L', `${cmdOpts.port}:localhost:${cmdOpts.port}`);
      }

      let {user, host} = getConnectInfo(instance, cmdOpts, sshInfo);

      sshOpts.push(`${user}@${host}`);

      if (cmdOpts.opts) {
        console.log(sshOpts.join(' '));
        process.exit();
      }

      function runSSH() {
        // hand off to SSH
        console.info('Connecting to', instance.InstanceId);
        spawn('ssh', sshOpts, {stdio: [0, 1, 2]});
      }

      if (sshInfo && sshInfo.prints) {
        verifyHostKey(host, sshInfo.prints).then(runSSH);
      } else {
        runSSH();
      }
    });
}

opts.parse();
