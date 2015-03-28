import nomnom from "nomnom";
import fs from "fs";
import ini from "ini";
import AWS from "aws-sdk";

let opts = nomnom()
  .script('easy2')
  .option('key', {
    abbr: 'k',
    help: "Key name for the instance."
  })
  .option('user', {
    abbr: 'u',
    default: 'ubuntu',
    help: "Log in as this user"
  })
  .option('verbose', {
    abbr: 'v',
    flag: true,
    help: "Pass this flag to display debug output."
  });

opts.command('dns')
  .callback(dns)
  .help("Print DNS and bail.");

opts.command('list')
  .callback(list)
  .help("List matching instances.");

opts.command('forward')
  .callback(forward)
  .help("Port forward on a port to the matching instance.");

opts.command('opts')
  .callback(sshOpts)
  .help("Print full SSH option list that would be used.");

function debug() {
  if (opts.verbose) {
    var args = Array.prototype.slice.call(arguments);
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
  if (instances.length > 1) {
    let baseName = instances[0].Name;

    if (instances.some(instance => instance.Name !== baseName)) {
      console.error(filter, 'matches multiple different instances.');
      listInstances(instances);
    }

    // pick a random instance
    var index = Math.floor(Math.random() * instances.length);
    return instances[index];

  } else if (instances.length) {
    return instances[0];
  } else {
    console.error('No instances match', filter);
    process.exit(3);
  }
}

function dns(dnsOpts) {
  let match = parseMatch(dnsOpts._[1]);
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

function list() {

}

function forward() {

}

function sshOpts() {

}

opts.parse();
