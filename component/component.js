/*!!!!!!!!!!!Do not change anything between here (the DRIVERNAME placeholder will be automatically replaced at buildtime)!!!!!!!!!!!*/
import NodeDriver from 'shared/mixins/node-driver'
import { otcClient } from './client'
// do not remove LAYOUT, it is replaced at build time with a base64 representation of the template of the hbs template
// we do this to avoid converting template to a js file that returns a string and the cors issues that would come along
// with that
const LAYOUT
/*!!!!!!!!!!!DO NOT CHANGE END!!!!!!!!!!!*/

/*!!!!!!!!!!!GLOBAL CONST START!!!!!!!!!!!*/
// EMBER API Access - if you need access to any of the Ember API's add them here in the same manner rather then import
// them via modules, since the dependencies exist in rancher we dont want to expor the modules in the amd def
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
        "access":              "Account Access",
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
        "osUsername":          "OpenStack Username",
        "osPassword":          "OpenStack Password",
        "osUserDomainName":    "OpenStack Domain Name",
        "osProjectName":       "OpenStack Project Name",
        "accessKey":           "Access Key ID",
        "accessSecret":        "Access Key Secret",
        "availableZone":       {
          "header":   "Availability",
          "label":    {
            "zone":   "Zone",
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
          "security": "Security Group",
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

export default Ember.Component.extend(NodeDriver, {
  driverName: '%%DRIVERNAME%%',
  config:     alias('model.%%DRIVERNAME%%Config'),
  app:        service(),

  catalogUrls:        null,
  step:               1,
  _prevStep:          1,
  errors:             null,
  intl:               service(),
  volumeTypes:        a2f(diskTypes),
  itemsLoading:       false,
  flavors:            [],
  images:             [],
  vpcs:               [],
  osAvailabilityZone: null,
  subnet:             null,

  authSuccess:  false,
  subnets:      [],
  vpcEndpoint:  '',
  novaEndpoint: '',
  newVPC:       { create: false, name: '', cidr: '192.168.0.0/16' },
  newSubnet:    { create: false, name: '', cidr: '192.168.0.0/24', gatewayIP: '192.168.0.1' },

  otc: null,

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
    let config = get(this, 'globalStore').createRecord({
      type:        '%%DRIVERNAME%%Config',
      region:      'eu-de',
      sshUser:     'linux',
      username:    '',
      password:    '',
      domainName:  '',
      projectName: '',
      vpcId:       '',
      subnetId:    '',
      flavorId:    '',
      imageId:     '',
    })

    set(this, 'config', config)
    set(this, 'model.%%DRIVERNAME%%Config', config)

    const lang = get(this, 'session.language') || 'en-us'
    get(this, 'intl.locale')
    this.loadLanguage(lang)

    set(this, 'otc', otcClient(region))
  },
  actions:   {
    authClient() {
      return get(this, 'otc').authenticate(
        get(this, 'config.username'),
        get(this, 'config.password'),
        get(this, 'config.domainName'),
        get(this, 'config.projectName'),
      ).then(() => {
        set(this, 'authSuccess', true)
        return resolve()
      }).catch(e => {
        set(this, 'errors', [e])
        return reject()
      })
    },

  },

  validate() {
    this._super(...arguments)
    let errors = get(this, 'errors')

    if (!get(this, 'config.flavorId')) {
      errors.push('Flavor is required')
    }

    if (!get(this, 'config.imageId')) {
      errors.push('Image is required')
    }

    this.set('errors', errors)
    return errors.length === 0
  },

  createVPC(cb) {
    return get(this, 'otc').createVPC(
      get(this, 'newVPC.name'),
      get(this, 'newVPC.cidr'),
    ).then(vpcID => {
      set(this, 'config.vpcId', vpcID)
      set(this, 'newVPC.create', false)
      set(this, 'newVPC.name', '')
      set(this, 'errors', [])
      this.updateVPCs()
      cb(true)
    }).catch((er) => {
      set(this, 'newVPC.name', '')
      set(this, 'errors', [JSON.stringify(er)])
      cb(false)
    })
  },
  createSubnet(cb) {
    return get(this, 'otc').createSubnet(
      get(this, 'config.vpcId'),
      get(this, 'newSubnet.name'),
      get(this, 'newSubnet.cidr'),
      get(this, 'newSubnet.gatewayIP'),
    ).then(subnetID => {
      set(this, 'config.subnetId', subnetID)
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
    return get(this, 'otc').listVPCs().then(vpcs => {
      set(this, 'vpcs', vpcs)
      return resolve()
    }).catch(() => {
      console.error('Failed to get VPCs')
      return reject()
    })
  },

  subnetChoices: computed('subnets', function () {
    const subnets = get(this, 'subnets')
    return subnets.map((sn) => ({ label: `${sn.name}(${sn.cidr})`, value: sn.id }))
  }),
  updateSubnets: function () {
    const vpcId = get(this, 'config.vpcId')
    if (!vpcId) {
      return []
    }
    return get(this, 'otc').listSubnets(vpcId).then(subnets => {
      console.log('Subnets: ', subnets)
      set(this, 'subnets', subnets)
      return resolve()
    }).catch((e) => {
      console.error('Failed to get subnets: ', e)
      return reject()
    })
  },
  vpcUpdated:    observer('config.vpcId', function () {
    this.updateSubnets()
  }),

  nodeFlavorChoices: computed('authSuccess', function () {
    return get(this, 'otc').listNodeFlavors().then(flavors => {
      console.log('Flavors: ', flavors)
      return flavors.map((f) => ({ label: f.name, value: f.id }))
    }).catch(() => {
      console.log('Failed to load node flavors')
    })
  }),

  keyPairChoices: computed('authSuccess', function () {
    if (!get(this, 'authSuccess')) {
      return []
    }
    return get(this, 'otc').listKeyPairs().then(keyPairs => {
      console.log('Received key pairs: ', keyPairs)
      return keyPairs.map((k) => {
        let name = k.keypair.name
        if (name.length > 20) {
          name = name.substring(0, 17) + '...'
        }
        return {
          label: `${name} (${k.keypair.fingerprint})`,
          value: k.keypair.name
        }
      })
    }).catch(() => {
      console.log('Failed to load key pairs')
      return reject()
    })
  }),

  languageChanged: observer('intl.locale', function () {
    const lang = get(this, 'intl.locale')
    if (lang) {
      this.loadLanguage(lang[0])
    }
  }),
})
