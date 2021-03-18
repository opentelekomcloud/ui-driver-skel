/*!!!!!!!!!!!Do not change anything between here (the DRIVERNAME placeholder will be automatically replaced at buildtime)!!!!!!!!!!!*/
import NodeDriver from 'shared/mixins/node-driver'
import oms from '@opentelekomcloud/oms'
// do not remove LAYOUT, it is replaced at build time with a base64 representation of the template of the hbs template
// we do this to avoid converting template to a js file that returns a string and the cors issues that would come along
// with that
const LAYOUT;
/*!!!!!!!!!!!DO NOT CHANGE END!!!!!!!!!!!*/

/*!!!!!!!!!!!GLOBAL CONST START!!!!!!!!!!!*/
// EMBER API Access - if you need access to any of the Ember API's add them here in the same manner rather then import
// them via modules, since the dependencies exist in rancher we dont want to export the modules in the amd def
const $ = Ember.$
const computed = Ember.computed
const observer = Ember.observer
const get = Ember.get
const set = Ember.set
const alias = Ember.computed.alias
const service = Ember.inject.service
const reject = Ember.RSVP.reject
const resolve = Ember.RSVP.resolve
const all = Ember.RSVP.all
const setProperties = Ember.setProperties

const defaultRadix = 10
const defaultBase = 1024
/*!!!!!!!!!!!GLOBAL CONST END!!!!!!!!!!!*/

const diskTypes = ['SATA', 'SAS', 'SSD']

const availabilityZones = [
  'eu-de-01',
  'eu-de-02',
  'eu-de-03',
]

const authURL = 'https://iam.eu-de.otc.t-systems.com/v3'

const defaultBandwidth = 100
const defaultFloatingIPType = '5_bgp'
const defaultShareType = 'PER'

const ubuntuRegex = new RegExp('_[Uu]buntu_')

/**
 * Convert string array to field array
 * @param src {string[]}
 * @returns {{label, value}[]}
 */
function a2f(src) {
  return src.map((v) => ({ label: v, value: v }))
}

const languages = {
  "en-us": {
    "machine": {
      "driverOtc": {
        "access":              "User Credentials",
        "authorize":           "Authorize",
        "next":                {
          "availability": "Next: Select Availability",
          "networks":     "Next: Select Subnet",
          "instance":     "Next: Select Instance Options"
        },
        "errors":              {
          "akId":    "A Access Key ID is required",
          "akS":     "A Access Key Secret is required",
          "project": "A Project ID is required"
        },
        "loadingAvailability": "Loading Availability and VPCs",
        "loadingNetworks":     "Loading Networks",
        "loadingFlavors":      "Loading Instance Options",
        "provided":            {
          "password": "Password Provided"
        },
        "projectId":           "Project ID",
        "osUsername":          "Username",
        "osPassword":          "Password",
        "osUserDomainName":    "Domain Name",
        "osProjectName":       "Project Name",
        "availableZone":       {
          "header":   "Availability",
          "label":    {
            "zone":   "Availability Zone",
            "region": "Region"
          },
          "dropdown": {
            "zone": "Select a Zone"
          }
        },
        "region":              null,
        "vpcAndSecurity":      {
          "header":   "Subnet and Security Groups",
          "vpc":      "VPC",
          "security": "Security Groups",
          "subnet":   "Subnet",
          "dropdown": {
            "vpc":      "Select a VPC",
            "security": "Select a Security Group",
            "subnet":   "Select a Subnet"
          }
        },
        "instance":            {
          "header":         "Instance",
          "options":        "Instance Options",
          "flavorid":       "Flavor ID",
          "images":         "Images",
          "sshUser":        "SSH User",
          "rootPassword":   "Root Password",
          "privateKey":     "SSH Private Key",
          "rootVolume":     "Root Volume Size",
          "rootVolumeType": "Root Volume Type",
          "size":           "Bandwidth Size",
          "dropdown":       {
            "flavorid": "Select a Flavor",
            "imageid":  "Select a Image",
            "type":     "Select a Volume Type"
          }
        }
      }
    }
  }
}

const region = 'eu-de'

//=require ../vendor/*.js

/**
 * Convert external URL to rancher meta proxy's URL
 * @param {string} url
 * @returns {string}
 */
function viaProxy(url) {
  const serverURL = window.location
  const baseURL = `${serverURL.protocol}//${serverURL.host}`
  url = url.replace('://', ':/')
  return `${baseURL}/meta/proxy/${url}`
}

export default Ember.Component.extend(NodeDriver, {
  driverName: '%%DRIVERNAME%%',
  config:     alias('model.%%DRIVERNAME%%Config'),
  app:        service(),

  catalogUrls:  null,
  step:         1,
  _prevStep:    1,
  errors:       [],
  intl:         service(),
  volumeTypes:  a2f(diskTypes),
  itemsLoading: false,
  flavors:      [],
  images:       [],
  vpcs:         [],
  subnet:       null,

  authSuccess: false,
  subnets:     [],
  newVPC:      { create: false, name: '', cidr: '192.168.0.0/16' },
  newSubnet:   { create: false, name: '', cidr: '192.168.0.0/16', gatewayIP: '192.168.0.1' },

  client: oms.Client = null,

  init() {
    // This does on the fly template compiling, if you mess with this :cry:
    const decodedLayout = window.atob(LAYOUT)
    const template = Ember.HTMLBars.compile(decodedLayout, {
      moduleName: 'nodes/components/driver-%%DRIVERNAME%%/template'
    })
    set(this, 'layout', template)

    this._super(...arguments)

  },
  /*!!!!!!!!!!!DO NOT CHANGE END!!!!!!!!!!!*/


  // Write your component here, starting with setting 'model' to a machine with your config populated
  bootstrap: function () {
    let configField = get(this, 'configField')
    let config = get(this, 'globalStore').createRecord({
      type:             '%%DRIVERNAME%%Config',
      region:           region,
      username:         '',
      password:         '',
      domainName:       '',
      projectName:      'eu-de',
      availabilityZone: '',
      vpcId:            '',
      subnetId:         '',
      flavorId:         '',
      imageId:          '',
      secGroups:        [],
      k8sGroup:         true,
      keypairName:      '',
    })

    set(this, 'config', config)
    set(this, 'model.${configField}', config)
    set(this, 'cluster.driver', get(this, 'driverName'));

    const lang = get(this, 'session.language') || 'en-us'
    get(this, 'intl.locale')
    this.loadLanguage(lang)

    console.log(`Config: ${JSON.stringify(config)}`)
  },

  actions: {
    authClient(domainName, username, password, projectName) {
      const client = new oms.Client({
        auth: {
          auth_url:     authURL,
          domain_name:  domainName,
          username:     username,
          password:     password,
          project_name: projectName,
        }
      })
      // proxy should be the last handler, after the signature calculation
      client.httpClient.beforeRequest.last = (config) => {
        if (config.baseURL !== '') {
          config.baseURL = viaProxy(config.baseURL)
        } else {
          config.url = viaProxy(config.url)
        }
        return config
      }
      return client.authenticate().then(() => {
        set(this, 'client', client)
        set(this, 'token', client.tokenID)
        set(this, 'authSuccess', true)
        set(this, 'step', 2)
        return resolve()
      }).catch((e) => {
        set(this, 'errors', [e])
        return reject()
      })
    },

    goToStep3() {
      set(this, 'errors', [])
      set(this, 'step', 3)
    },

    multiSecurityGroupSelect() {
      let options = Array.prototype.slice.call($('.existing-security-groups')[0], 0);
      let selectedOptions = [];

      options.filterBy('selected', true).forEach((cap) => {
        return selectedOptions.push(cap.value);
      });
      console.debug(`Selected security groups: ${selectedOptions}`)
      set(this, 'config.secGroups', selectedOptions);
    },

    goToStep4() {
      set(this, 'errors', [])
      set(this, 'step', 4)
    },

  },

  validate() {
    this._super(...arguments)
    const errors = []

    if (!get(this, 'config.flavorId')) {
      errors.push('Flavor is required')
    }

    if (!get(this, 'config.imageId')) {
      errors.push('Image is required')
    }

    set(this, 'errors', errors)
    return errors.length === 0
  },

  createVPC(cb) {
    const srv = get(this, 'client').getService(oms.VpcV1)
    return srv.createVPC(
      get(this, 'newVPC.name'),
      get(this, 'newVPC.cidr'),
    ).then(vpcID => {
      set(this, 'config.vpcId', vpcID)
      set(this, 'newVPC.create', false)
      set(this, 'newVPC.name', '')
      set(this, 'errors', [])
      cb(true)
    }).catch((er) => {
      set(this, 'newVPC.name', '')
      set(this, 'errors', [JSON.stringify(er)])
      cb(false)
    })
  },
  createSubnet(cb) {
    const srv = get(this, 'client').getService(oms.VpcV1)
    return srv.createSubnet({
      vpc_id:     get(this, 'config.vpcId'),
      name:       get(this, 'newSubnet.name'),
      cidr:       get(this, 'newSubnet.cidr'),
      gateway_ip: get(this, 'newSubnet.gatewayIP'),
    }).then(subnet => {
      set(this, 'config.subnetId', subnet.id)
      set(this, 'newSubnet.name', '')
      set(this, 'newSubnet.create', false)
      set(this, 'errors', [])
      this.updateSubnets()
      cb(true)
    }).catch((er) => {
      set(this, 'newSubnet.name', '')
      set(this, 'errors', [JSON.stringify(er)])
      cb(false)
    })
  },

  authFieldsMissing:  true,
  onAuthFieldsChange: observer('config.username', 'config.password', 'config.domainName', 'config.projectName', function () {
    const missing = !(
      get(this, 'config.username') &&
      get(this, 'config.password') &&
      get(this, 'config.domainName') &&
      get(this, 'config.projectName')
    )
    set(this, 'authFieldsMissing', missing)
  }),

  projectChoices:       [],
  projectChoicesUpdate: observer('config.username', 'config.password', 'config.domainName', function () {
    const username = get(this, 'config.username')
    const password = get(this, 'config.password')
    const domainName = get(this, 'config.domainName')
    if (!(username && password && domainName)) {
      return []
    }
    const client = new oms.Client({
      auth: {
        auth_url:    authURL,
        domain_name: domainName,
        username:    username,
        password:    password,
      }
    })
    return client.authenticate().then(() => {
      const srv = get(this, 'client').getService(oms.IdentityV3)
      return srv.listProjects().then(projects => {
        const projectCh = projects.map(p => ({ label: p.name, value: p.id }))
        set(this, 'projectChoices', projectCh)
      })
    })
  }),

  loadLanguage(lang) {
    const translation = languages[lang]
    const intl = get(this, 'intl')

    intl.addTranslations(lang, translation)
    intl.translationsFor(lang)
    console.log('Added translation for ' + lang)
  },

  vpcChoices: computed('vpcs', function () {
    const vpcs = get(this, 'vpcs')
    return vpcs.map((vpc) => ({ label: `${vpc.name} (${vpc.id})`, value: vpc.id }))
  }),
  updateVPCs: function () {
    const srv = get(this, 'client').getService(oms.VpcV1)
    return srv.listVPCs().then(vpcs => {
      set(this, 'vpcs', vpcs)
      console.log(`VPCs: ${JSON.stringify(vpcs)}`)
      return resolve()
    }).catch((e) => {
      console.error(`Failed to get VPCs: ${e}`)
      return reject()
    })
  },
  loadVPCs:   observer('authSuccess', function () {
    if (get(this, 'authSuccess')) {
      this.updateVPCs()
    }
  }),

  subnetChoices: computed('subnets', function () {
    const subnets = get(this, 'subnets')
    return subnets.map((sn) => ({ label: `${sn.name}(${sn.cidr})`, value: sn.id }))
  }),
  updateSubnets: function () {
    const vpcId = get(this, 'config.vpcId')
    if (!vpcId) {
      return []
    }
    const srv = get(this, 'client').getService(oms.VpcV1)
    return srv.listSubnets(vpcId).then(subnets => {
      console.log('Subnets: ', subnets)
      set(this, 'subnets', subnets)
      return resolve()
    }).catch((e) => {
      console.error('Failed to get subnets: ', e)
      return reject()
    })
  },
  vpcUpdated:    observer('config.vpcId', function () {
    console.log(`VPC is now set to ${get(this, 'config.vpcId')}`)
    this.updateSubnets()
  }),

  nodeFlavorChoices: computed('authSuccess', function () {
    return get(this, 'client').listFlavors().then(flavors => {
      console.log('Flavors: ', flavors)
      return flavors.map((f) => ({ label: f.name, value: f.id }))
    }).catch(() => {
      console.log('Failed to load node flavors')
    })
  }),

  azChoices: a2f(availabilityZones),

  imageChoices: computed('authSuccess', function () {
    if (!get(this, 'authSuccess')) {
      return []
    }
    const srv = get(this, 'client').getService(oms.ComputeV2)
    const pager = srv.listImages()
    return pager.all().then(page => {
      return page.images.map(i => {
        return {
          label: i.name,
          value: i.id,
        }
      })
    })
  }),

  sgChoices: [],
  sgUpdate:  observer('authSuccess', function () {
    if (!get(this, 'authSuccess')) {
      return
    }
    const srv = get(this, 'client').getService(oms.VpcV1)
    return srv.listSecurityGroups().then(groups => {
      console.log(`Got groups: ${JSON.stringify(groups)}`)
      const choices = groups.map(g => {
        return {
          label: `${g.name} (${g.id})`,
          value: g.id
        }
      })
      set(this, 'sgChoices', choices)
    }).catch(() => {
      console.log('Failed to load sec groups')
      return reject()
    })
  }),

  languageChanged: observer('intl.locale', function () {
    const lang = get(this, 'intl.locale')
    if (lang) {
      this.loadLanguage(lang[0])
    }
  }),

  readyForStep4: computed('config.secGroups', 'config.subnetId', function () {
    return get(this, 'config.secGroups').length && get(this, 'config.subnetId')
  }),

  refreshDefaults: observer('authSuccess', function () {
    if (!get(this, 'authSuccess')) {
      return
    }
    const defaultImageName = get(this, 'config.imageName')
    get(this, 'imageChoices').then(images => {
      const defaultImageId = images.find(i => i.label === defaultImageName).value
      set(this, 'config.imageId', defaultImageId)
    })
  }),

  imageSelected: observer('config.imageId', function () {
    const imageId = get(this, 'config.imageId')
    get(this, 'imageChoices').then(images => {
      const imageName = images.find(i => i.value === imageId).label
      set(this, 'config.imageName', imageName)
    })
  }),

  ubuntuSelected: observer('config.imageName', function () {
    const imageName = get(this, 'config.imageName')
    if (ubuntuRegex.test(imageName)) {  // default user for Ubuntu... images is `ubuntu`
      set(this, 'config.sshUser', 'ubuntu')
    } else {
      set(this, 'config.sshUser', 'linux')
    }
  }),

  volumeTypeChoices: a2f(diskTypes),

  version: '%%DRIVERVERSION%%',

})
